/**
 * Enrich new_contracts page-by-page (no page_id column):
 *   1. Load state_wise_contract_list_pages WHERE is_scraped=FALSE (order: from_date, page_number)
 *   2. Re-fetch that GeM listing page → get contract numbers on the page
 *   3. Enrich each pending contract (captcha → PDF → S3 → seller/buyer)
 *   4. When all contracts on that page have seller_id + buyer_id → is_scraped=TRUE
 *   5. Only then move to the next page
 *
 * Resume / crash-safe:
 *   - Finished pages stay is_scraped=TRUE and are never reloaded
 *   - Mid-page progress is kept in new_contracts (order_id, pdf_url, seller_id, buyer_id)
 *   - Restart skips already-enriched contracts and continues from the first pending one
 *   - Incomplete page keeps is_scraped=FALSE so the next run resumes that same page
 *   - Fatal crashes auto-restart after 30s (Ctrl+C stops cleanly)
 *
 *   node src/gem/new_contract_scrapped.js
 *   node src/gem/new_contract_scrapped.js --state "Gujarat" --delay-3
 *   node src/gem/new_contract_scrapped.js --contract GEMC-511687790081951
 *   node src/gem/new_contract_scrapped.js --parts=10 --part=1
 *   node src/gem/new_contract_scrapped.js --limit 5
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const cheerio = require('cheerio');
const { Pool, types } = require('pg');
types.setTypeParser(types.builtins.DATE, (val) => val);

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { PDFParse } = require('pdf-parse');
const { parsePdfSections } = require('./pdf_parse_sections');
const { parseGemContractDate } = require('../lib/htmlFields');
const { normalizeBuyingMode } = require('../lib/contractLookups');
const {
  updateNewContractOrderAndPdf,
  saveScrapedContract,
} = require('../lib/syncNewTables');

const LANDING = 'https://gem.gov.in/view_contracts';
const LISTING_URL = 'https://gem.gov.in/view_contracts/contract_details';
const SBT_CAPTCHA = 'https://gem.gov.in/view_contracts/sbtCaptcha';
const PDF_BASE = 'https://fulfillment.gem.gov.in/contract/fds';

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const REQUEST_TIMEOUT_MS = 120000;
const TIMEOUT_COOLDOWN_MS = 60000;
const LONG_COOLDOWN_MS = 180000;
const COOKIE_REFRESH_EVERY = 3;
const FATAL_RESTART_MS = 30000;
const EMPTY_LISTING_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set by SIGINT/SIGTERM — finish current contract, then stop (page stays resumable). */
let stopRequested = false;

function installStopHandlers() {
  const onStop = (sig) => {
    if (stopRequested) {
      console.log(`\n${sig} again — forcing exit`);
      process.exit(1);
    }
    stopRequested = true;
    console.log(`\n${sig} received — will stop after current contract (safe to resume later)`);
  };
  process.on('SIGINT', () => onStop('SIGINT'));
  process.on('SIGTERM', () => onStop('SIGTERM'));
}

function parseArgs(argv) {
  const out = {
    delaySec: 0,
    reverse: false,
    part: 0,
    parts: 0,
    limit: 0,
    resync: false,
    state: '',
    contract: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--reverse') out.reverse = true;
    else if (a === '--resync') out.resync = true;
    else if (delayMatch) out.delaySec = Number(delayMatch[1]);
    else if (partSlash) {
      out.part = Number(partSlash[1]);
      out.parts = Number(partSlash[2]);
    } else if (
      a === '--delay' ||
      a === '--state' ||
      a === '--name' ||
      a === '--contract' ||
      a === '--part' ||
      a === '--parts' ||
      a === '--limit'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else if (key === 'limit') out.limit = Number(val);
      else if (key === 'state' || key === 'name') out.state = val;
      else if (key === 'contract') out.contract = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--state=')) out.state = a.slice(8);
    else if (a.startsWith('--name=')) out.state = a.slice(7);
    else if (a.startsWith('--contract=')) out.contract = a.slice(11);
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
  }
  if (Number.isNaN(out.delaySec) || out.delaySec < 0) out.delaySec = 0;
  if (Number.isNaN(out.part) || out.part < 0) out.part = 0;
  if (Number.isNaN(out.parts) || out.parts < 0) out.parts = 0;
  if (Number.isNaN(out.limit) || out.limit < 0) out.limit = 0;
  return out;
}

function slicePart(list, part, parts) {
  if (!part && !parts) return list;
  if (!parts || parts < 1) throw new Error('Use --parts=N with --part=K');
  if (!part || part < 1 || part > parts) throw new Error(`--part must be 1..${parts}`);
  const n = list.length;
  const base = Math.floor(n / parts);
  const rem = n % parts;
  let start = 0;
  for (let p = 1; p < part; p++) start += base + (p <= rem ? 1 : 0);
  return list.slice(start, start + (base + (part <= rem ? 1 : 0)));
}

function toGemStateName(name) {
  return String(name || '').trim().toUpperCase();
}

/** YYYY-MM-DD or Date → DD-MM-YYYY for GeM */
function toGemDate(val) {
  const s = String(val).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  }
  throw new Error(`Bad date: ${val}`);
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

function createS3() {
  return new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadPdfToS3(s3, buf, contractNumber) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) throw new Error('S3_BUCKET_NAME missing in .env');
  const region = process.env.AWS_REGION || 'ap-south-1';
  const key = `gem/contracts/${contractNumber}.pdf`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: 'application/pdf',
    })
  );
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

async function loadUnscrapedPages(pool, { state = '' } = {}) {
  const params = [];
  const where = ['p.is_scraped = FALSE'];
  if (state) {
    params.push(state);
    where.push(`lower(s.name) = lower($${params.length})`);
  }
  const { rows } = await pool.query(
    `SELECT
       p.id AS page_id,
       p.page_number,
       p.from_date::text AS from_date,
       p.to_date::text AS to_date,
       p.total_contracts AS page_total_contracts,
       l.state_id,
       s.name AS state_name
     FROM state_wise_contract_list_pages p
     JOIN state_wise_contract_lists l ON l.id = p.state_wise_contract_list_id
     JOIN states s ON s.id = l.state_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.from_date ASC, p.to_date ASC, p.page_number ASC`,
    params
  );
  return rows;
}

async function loadContractByNumber(client, contractNumber) {
  const { rows } = await client.query(
    `SELECT
       c.id, c.contract_number, c.order_id, c.contract_pdf_url, c.state_id, c.ministry_id,
       c.seller_id, c.buyer_id, c.org_type, c.org_name, c.department, c.office_zone,
       c.status_of_the_contract, c.total_value, c.bid_number, c.buyer_designation,
       c.buying_mode, c.contract_date::text AS contract_date, c.products, c.consinee_details,
       s.name AS state_name
     FROM new_contracts c
     LEFT JOIN states s ON s.id = c.state_id
     WHERE c.contract_number = $1
     LIMIT 1`,
    [contractNumber]
  );
  return rows[0] || null;
}

async function loadContractsFlat(pool, { state = '', contract = '', resync = false } = {}) {
  const params = [];
  const where = [`c.contract_number IS NOT NULL`, `BTRIM(c.contract_number) <> ''`];
  if (!resync) where.push('(c.seller_id IS NULL OR c.buyer_id IS NULL)');
  if (state) {
    params.push(state);
    where.push(`lower(s.name) = lower($${params.length})`);
  }
  if (contract) {
    params.push(contract);
    where.push(`c.contract_number = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT
       c.id, c.contract_number, c.order_id, c.contract_pdf_url, c.state_id, c.ministry_id,
       c.seller_id, c.buyer_id, c.org_type, c.org_name, c.department, c.office_zone,
       c.status_of_the_contract, c.total_value, c.bid_number, c.buyer_designation,
       c.buying_mode, c.contract_date::text AS contract_date, c.products, c.consinee_details,
       s.name AS state_name
     FROM new_contracts c
     LEFT JOIN states s ON s.id = c.state_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.created_at ASC, c.contract_number ASC`,
    params
  );
  return rows;
}

/** Stats for a list of contract numbers on one GeM page. */
async function getContractsDoneStats(client, contractNumbers) {
  if (!contractNumbers.length) return { total: 0, done: 0, pending: 0, pendingNumbers: [] };
  const { rows } = await client.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE seller_id IS NOT NULL AND buyer_id IS NOT NULL)::int AS done,
       COUNT(*) FILTER (WHERE seller_id IS NULL OR buyer_id IS NULL)::int AS pending
     FROM new_contracts
     WHERE contract_number = ANY($1::text[])`,
    [contractNumbers]
  );
  const pendingRes = await client.query(
    `SELECT contract_number
     FROM new_contracts
     WHERE contract_number = ANY($1::text[])
       AND (seller_id IS NULL OR buyer_id IS NULL)
     ORDER BY contract_number ASC`,
    [contractNumbers]
  );
  return {
    total: rows[0]?.total || 0,
    done: rows[0]?.done || 0,
    pending: rows[0]?.pending || 0,
    pendingNumbers: pendingRes.rows.map((r) => r.contract_number),
  };
}

function pageLabel(page) {
  return `${page.state_name} ${page.from_date}→${page.to_date} p=${page.page_number}`;
}

/** First unscraped page + how many contracts already enriched on it (DB-only peek). */
async function getResumeCursor(pool, pages) {
  if (!pages.length) return null;
  const first = pages[0];
  return {
    page: first,
    label: pageLabel(first),
  };
}

async function markPageScraped(client, pageId, totalContracts = null) {
  await client.query(
    `UPDATE state_wise_contract_list_pages
     SET is_scraped = TRUE,
         total_contracts = COALESCE($2, total_contracts),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [pageId, totalContracts]
  );
}

/**
 * Page is fully scraped when every GeM contract number on that page
 * exists in new_contracts with seller_id AND buyer_id set.
 */
function isPageComplete(stats, contractNumbers, pageErrors) {
  return (
    pageErrors === 0 &&
    contractNumbers.length > 0 &&
    stats.pending === 0 &&
    stats.total === contractNumbers.length &&
    stats.done === stats.total
  );
}

function rowToBlock(row) {
  let products = row.products;
  if (typeof products === 'string') {
    try {
      products = JSON.parse(products);
    } catch {
      products = [];
    }
  }
  if (!Array.isArray(products)) products = [];
  let contractDate = row.contract_date || '';
  if (/^\d{4}-\d{2}-\d{2}/.test(String(contractDate))) {
    const [y, m, d] = String(contractDate).slice(0, 10).split('-');
    contractDate = `${Number(d)}/${Number(m)}/${y}`;
  }
  return {
    contract_number: row.contract_number,
    status_of_the_contract: row.status_of_the_contract || '',
    org_type: row.org_type || '',
    org_name: row.org_name || '',
    department: row.department || '',
    office_zone: row.office_zone || '',
    buyer_designation: row.buyer_designation || '',
    bid_number: row.bid_number || '',
    total_value: row.total_value != null ? Number(row.total_value) : null,
    products_from_html: products,
    buying_mode: row.buying_mode || '',
    contract_date: contractDate,
    ministry_label: '',
  };
}

function textOf($, el) {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

function fieldByLabel($root, $, labels) {
  const wanted = labels.map((l) => l.toLowerCase());
  let found = '';
  $root.find('p').each((_, p) => {
    const strong = $(p).find('strong').first().text().replace(/:\s*$/, '').trim().toLowerCase();
    if (!wanted.includes(strong)) return;
    const span = $(p).find('span').first();
    if (span.length) {
      const a = span.find('a').first();
      found = a.length ? textOf($, a) : textOf($, span);
    } else {
      found = textOf($, p)
        .replace(new RegExp(`^${strong}\\s*:?\\s*`, 'i'), '')
        .trim();
    }
  });
  return found;
}

function parseProductsTable($block, $) {
  const products = [];
  $block.find('table.table tr').each((i, tr) => {
    if (i === 0) return;
    const cells = $(tr).find('td');
    if (cells.length < 4) return;
    products.push({
      product: textOf($, cells.eq(0)),
      brand: textOf($, cells.eq(1)),
      model: textOf($, cells.eq(2)),
      quantity: textOf($, cells.eq(3)),
      price: textOf($, cells.eq(4)).replace(/[₹,\s]/g, ''),
    });
  });
  return products;
}

/** Full listing blocks from GeM HTML (used to insert missing new_contracts rows). */
function parseContractBlocks(html) {
  const $ = cheerio.load(String(html || ''));
  const blocks = [];
  $('div.border.block, div.block.border').each((_, el) => {
    const $el = $(el);
    const contractNumber = textOf($, $el.find('.ajxtag_order_number').first());
    if (!contractNumber) return;

    const totalRaw = textOf($, $el.find('.ajxtag_totalvalue').first()).replace(/[₹,\s]/g, '');
    const totalValue = totalRaw && !Number.isNaN(Number(totalRaw)) ? Number(totalRaw) : null;

    blocks.push({
      contract_number: contractNumber,
      status_of_the_contract: textOf($, $el.find('.ajxtag_order_status').first()),
      org_type: fieldByLabel($el, $, ['Organization Type', 'Organisation Type']),
      org_name: fieldByLabel($el, $, ['Organization Name', 'Organisation Name']),
      department: fieldByLabel($el, $, ['Department']),
      office_zone: fieldByLabel($el, $, ['Office Zone']),
      buyer_designation: fieldByLabel($el, $, ['Buyer Designation']),
      bid_number: fieldByLabel($el, $, ['Bid Number']),
      total_value: totalValue,
      products_from_html: parseProductsTable($el, $),
      buying_mode: fieldByLabel($el, $, ['Buying Mode']),
      contract_date: fieldByLabel($el, $, ['Contract Date']),
      ministry_label: fieldByLabel($el, $, ['Ministry']),
    });
  });
  return blocks;
}

function parseContractNumbersFromHtml(html) {
  const blocks = parseContractBlocks(html);
  if (blocks.length) return [...new Set(blocks.map((b) => b.contract_number))];
  const m = String(html).match(/GEMC-\d+/g) || [];
  return [...new Set(m)];
}

async function resolveMinistryId(client, ministryLabel) {
  const name = String(ministryLabel || '').trim();
  if (!name) return null;
  const existing = await client.query(
    `SELECT id FROM contract_ministry WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  try {
    const inserted = await client.query(
      `INSERT INTO contract_ministry (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name]
    );
    return inserted.rows[0]?.id || null;
  } catch {
    return null;
  }
}

/** Insert listing stub when GeM shows a contract missing from new_contracts. */
async function ensureListingContract(client, { stateId, block }) {
  const contractNumber = String(block.contract_number || '').trim();
  if (!contractNumber) return null;

  const existing = await client.query(
    `SELECT id FROM new_contracts WHERE contract_number = $1 LIMIT 1`,
    [contractNumber]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const ministryId = await resolveMinistryId(client, block.ministry_label);
  const contractDate = parseGemContractDate(block.contract_date);
  const products = Array.isArray(block.products_from_html) ? block.products_from_html : [];
  const buyingMode = block.buying_mode ? normalizeBuyingMode(block.buying_mode) : null;

  const inserted = await client.query(
    `INSERT INTO new_contracts (
       state_id, ministry_id, contract_number, org_type, org_name,
       total_value, department, office_zone, status_of_the_contract,
       products, contract_date, bid_number, buyer_designation, buying_mode
     ) VALUES (
       $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9,
       $10::jsonb, $11::date, $12, $13, $14
     )
     RETURNING id`,
    [
      stateId,
      ministryId,
      contractNumber,
      block.org_type || null,
      block.org_name || null,
      block.total_value,
      block.department || null,
      block.office_zone || null,
      block.status_of_the_contract || null,
      JSON.stringify(products),
      contractDate,
      block.bid_number || null,
      block.buyer_designation || null,
      buyingMode,
    ]
  );
  return inserted.rows[0].id;
}

async function getCookie() {
  const res = await axios.get(LANDING, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });
  return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}

function gemHeaders(cookie) {
  return {
    Accept: '*/*',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Origin: 'https://gem.gov.in',
    Referer: LANDING,
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': UA,
    Cookie: cookie,
  };
}

function isRetryableError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.code || '';
  return (
    err?.code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    /timeout/i.test(msg) ||
    /network/i.test(msg) ||
    /socket hang up/i.test(msg)
  );
}

async function fetchListingPageOnce({ buyerState, fromDate, toDate, page, cookie, delayMs }) {
  const body = new URLSearchParams({
    buyer_entity: '',
    buyer_ministry: '',
    buyer_state: buyerState,
    fromDate,
    toDate,
    department: '',
    organization: '',
    page: String(page),
  });
  const { data, status } = await axios.post(LISTING_URL, body.toString(), {
    headers: gemHeaders(cookie),
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (delayMs > 0) await sleep(delayMs);
  return { data, status };
}

async function fetchListingPage({ buyerState, fromDate, toDate, page, cookieRef, delayMs }) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchListingPageOnce({
        buyerState,
        fromDate,
        toDate,
        page,
        cookie: cookieRef.cookie,
        delayMs,
      });
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      attempt += 1;
      const longPause = attempt % COOKIE_REFRESH_EVERY === 0;
      const waitMs = longPause ? LONG_COOLDOWN_MS : TIMEOUT_COOLDOWN_MS;
      console.log(`    listing page ${page}: timeout — wait ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      if (longPause) {
        try {
          cookieRef.cookie = await getCookie();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function normalizeOrderId(raw) {
  let orderId = String(raw ?? '').trim();
  if (!orderId) return '';
  if (orderId.startsWith('{') || orderId.startsWith('[')) {
    try {
      const j = JSON.parse(orderId);
      orderId = String(j.orderId || j.order_id || j.data || j.oid || orderId);
    } catch {
      /* keep */
    }
  }
  const fromQuery = orderId.match(/[?&]?orderId=([^&\s"'<>]+)/i);
  if (fromQuery) orderId = fromQuery[1];
  orderId = orderId.replace(/^orderId=/i, '').replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  const token = orderId.match(/[A-Za-z0-9+/=]{16,}/);
  if (token) orderId = token[0];
  return orderId;
}

async function fetchOrderIdOnce(contractNumber, cookie, delayMs) {
  const { data, status } = await axios.post(
    SBT_CAPTCHA,
    new URLSearchParams({ oid: contractNumber }).toString(),
    {
      headers: gemHeaders(cookie),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d) => d],
    }
  );
  if (delayMs > 0) await sleep(delayMs);
  if (status >= 400) throw new Error(`sbtCaptcha HTTP ${status}`);
  const orderId = normalizeOrderId(data);
  if (!orderId) throw new Error(`empty order_id for ${contractNumber}`);
  return orderId;
}

async function fetchOrderId(contractNumber, cookieRef, delayMs) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchOrderIdOnce(contractNumber, cookieRef.cookie, delayMs);
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      attempt += 1;
      const waitMs = attempt % COOKIE_REFRESH_EVERY === 0 ? LONG_COOLDOWN_MS : TIMEOUT_COOLDOWN_MS;
      console.log(`      sbtCaptcha timeout — wait ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      if (attempt % COOKIE_REFRESH_EVERY === 0) {
        try {
          cookieRef.cookie = await getCookie();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function downloadPdfOnce(orderId, delayMs) {
  const { data, status, headers } = await axios.get(
    `${PDF_BASE}?orderId=${encodeURIComponent(orderId)}`,
    {
      headers: { Accept: 'application/pdf,*/*', 'User-Agent': UA, Referer: LANDING },
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'arraybuffer',
      validateStatus: () => true,
    }
  );
  if (delayMs > 0) await sleep(delayMs);
  if (status >= 400) throw new Error(`PDF download HTTP ${status}`);
  const buf = Buffer.from(data);
  const ctype = String(headers['content-type'] || '');
  if (buf.length < 100 || (ctype.includes('html') && buf.slice(0, 20).toString().includes('<'))) {
    throw new Error('PDF download did not return a valid PDF file');
  }
  return buf;
}

async function downloadPdf(orderId, cookieRef, delayMs) {
  let attempt = 0;
  for (;;) {
    try {
      return await downloadPdfOnce(orderId, delayMs);
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      attempt += 1;
      const waitMs = attempt % COOKIE_REFRESH_EVERY === 0 ? LONG_COOLDOWN_MS : TIMEOUT_COOLDOWN_MS;
      console.log(`      pdf timeout — wait ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
      if (attempt % COOKIE_REFRESH_EVERY === 0) {
        try {
          cookieRef.cookie = await getCookie();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function extractPdfText(buf) {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result.text || '');
  } finally {
    if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
  }
}

async function enrichStateContract({ client, s3, row, cookieRef, delayMs }) {
  const contractNumber = row.contract_number;
  const block = rowToBlock(row);
  const hadOrder = Boolean(normalizeOrderId(row.order_id));
  const hadPdf = Boolean(row.contract_pdf_url);
  const hadPartial = hadOrder || hadPdf;
  if (hadPartial) {
    console.log(
      `      resume enrich (order_id=${hadOrder ? 'yes' : 'no'}, pdf=${hadPdf ? 'yes' : 'no'})`
    );
  }

  let orderId = normalizeOrderId(row.order_id);
  if (row.order_id && orderId && row.order_id !== orderId) {
    await updateNewContractOrderAndPdf(client, row.id, orderId, null);
  }
  if (!orderId) {
    orderId = await fetchOrderId(contractNumber, cookieRef, delayMs);
    await updateNewContractOrderAndPdf(client, row.id, orderId, null);
    console.log(`      order_id obtained`);
  } else {
    console.log(`      order_id already exists`);
  }

  let pdfUrl = row.contract_pdf_url;
  let pdfBuf;
  if (!pdfUrl) {
    pdfBuf = await downloadPdf(orderId, cookieRef, delayMs);
    pdfUrl = await uploadPdfToS3(s3, pdfBuf, contractNumber);
    await updateNewContractOrderAndPdf(client, row.id, orderId, pdfUrl);
    console.log(`      pdf uploaded to S3`);
  } else {
    console.log(`      pdf url exists — downloading to parse`);
    pdfBuf = await downloadPdf(orderId, cookieRef, delayMs);
  }

  const parsed = parsePdfSections(await extractPdfText(pdfBuf));
  const seller = {
    seller_id: parsed.seller_details.seller_id,
    company_name: parsed.seller_details.company_name,
    phone: parsed.seller_details.contact_no,
    email: parsed.seller_details.email,
    address: parsed.seller_details.address,
    msme_certificate_number: parsed.seller_details.msme_certificate_number,
    gst_number: parsed.seller_details.gst_number,
  };
  const buyer = {
    company_name:
      parsed.organisation_details?.organisation_name ||
      parsed.buyer_details.name ||
      (parsed.buyer_details.address || '').split(',')[0] ||
      '',
    phone: parsed.buyer_details.contact_no,
    email: parsed.buyer_details.email,
    address: parsed.buyer_details.address,
    gst_number: parsed.buyer_details.gstin,
  };
  if (!seller.company_name && !seller.email && !seller.seller_id) {
    throw new Error('PDF parse produced empty seller details');
  }

  await saveScrapedContract(client, {
    existingId: row.id,
    ministryId: row.ministry_id || null,
    stateId: row.state_id,
    block,
    parsed,
    seller,
    buyer,
    orderId,
    pdfUrl,
  });
  console.log(
    `      saved → seller="${seller.company_name || seller.seller_id}" buyer="${buyer.company_name || buyer.email}"`
  );
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`
Page-wise enricher (crash-safe / resumable):
  Load state_wise_contract_list_pages WHERE is_scraped=FALSE
  → re-fetch GeM page → enrich pending contracts → set is_scraped=TRUE
  → only then move to next page

  On restart: skips finished pages + already-enriched contracts,
  continues from the first pending contract on the first open page.

  node src/gem/new_contract_scrapped.js
  node src/gem/new_contract_scrapped.js --state "Gujarat" --delay-3
  node src/gem/new_contract_scrapped.js --contract GEMC-...
  node src/gem/new_contract_scrapped.js --resync
  node src/gem/new_contract_scrapped.js --limit 5
`);
    return;
  }

  installStopHandlers();

  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const pool = createPool();
  const s3 = createS3();
  const wantedContract = cli.contract.trim();

  if (wantedContract) {
    const rows = await loadContractsFlat(pool, {
      state: cli.state.trim(),
      contract: wantedContract,
      resync: true,
    });
    if (!rows.length) {
      console.log(`No contract ${wantedContract}`);
      await pool.end();
      return;
    }
    const cookieRef = { cookie: await getCookie() };
    const client = await pool.connect();
    try {
      for (const row of rows) {
        if (stopRequested) break;
        console.log(`\n======== ${row.contract_number} ========`);
        cookieRef.cookie = await getCookie();
        await enrichStateContract({ client, s3, row, cookieRef, delayMs });
      }
    } finally {
      client.release();
      await pool.end();
    }
    console.log(stopRequested ? '\nStopped (safe to re-run same --contract)' : '\nAll done');
    return;
  }

  let pages = await loadUnscrapedPages(pool, { state: cli.state.trim() });
  if (!pages.length) {
    console.log('No unscraped pages (is_scraped = FALSE)');
    await pool.end();
    return;
  }
  if (cli.reverse) pages = [...pages].reverse();
  if (cli.part || cli.parts) {
    const before = pages.length;
    pages = slicePart(pages, cli.part, cli.parts);
    console.log(`Part: ${cli.part}/${cli.parts} (${pages.length} of ${before} pages)`);
  }

  const resume = await getResumeCursor(pool, pages);

  console.log(`Mode: page-wise enricher (GeM re-fetch per page, resumable)`);
  console.log(`Pages: ${pages.length}`);
  console.log(`State filter: ${cli.state || 'all'}`);
  console.log(`Limit: ${cli.limit || 'none'}`);
  console.log(`Delay: ${delayMs > 0 ? `${cli.delaySec}s` : 'off'}`);
  console.log(`Resume from: ${resume?.label || '(none)'}`);
  console.log(
    `First: ${pages[0].state_name} ${pages[0].from_date}→${pages[0].to_date} p=${pages[0].page_number}`
  );
  console.log(
    `Last:  ${pages[pages.length - 1].state_name} ${pages[pages.length - 1].from_date}→${pages[pages.length - 1].to_date} p=${pages[pages.length - 1].page_number}\n`
  );

  const cookieRef = { cookie: await getCookie() };
  let processed = 0;
  let saved = 0;
  let errors = 0;
  let pagesDone = 0;
  let skippedDone = 0;
  let lastResumeHint = resume?.label || '';

  const client = await pool.connect();
  try {
    for (const page of pages) {
      if (stopRequested) break;
      if (cli.limit > 0 && processed >= cli.limit) break;

      const buyerState = toGemStateName(page.state_name);
      const fromDate = toGemDate(page.from_date);
      const toDate = toGemDate(page.to_date);
      const expected = Number(page.page_total_contracts) || 0;
      lastResumeHint = pageLabel(page);

      console.log(
        `\n======== PAGE ${page.page_number} | ${page.state_name} | ${fromDate}→${toDate} | need ${expected} ========`
      );

      let contractNumbers = [];
      let contractBlocks = [];
      let listingOk = false;
      for (let listingTry = 1; listingTry <= EMPTY_LISTING_RETRIES; listingTry++) {
        if (stopRequested) break;
        cookieRef.cookie = await getCookie();
        const { data, status } = await fetchListingPage({
          buyerState,
          fromDate,
          toDate,
          page: page.page_number,
          cookieRef,
          delayMs,
        });

        if (status >= 400 || !data || !String(data).trim()) {
          console.log(
            `  ✗ empty listing (status=${status}) try ${listingTry}/${EMPTY_LISTING_RETRIES}`
          );
          if (listingTry < EMPTY_LISTING_RETRIES) await sleep(TIMEOUT_COOLDOWN_MS);
          continue;
        }

        contractBlocks = parseContractBlocks(data);
        contractNumbers = contractBlocks.length
          ? [...new Set(contractBlocks.map((b) => b.contract_number))]
          : parseContractNumbersFromHtml(data);
        if (!contractNumbers.length) {
          console.log(
            `  ✗ no contract numbers on page try ${listingTry}/${EMPTY_LISTING_RETRIES}`
          );
          if (listingTry < EMPTY_LISTING_RETRIES) await sleep(TIMEOUT_COOLDOWN_MS);
          continue;
        }

        listingOk = true;
        break;
      }

      if (stopRequested) break;

      if (!listingOk || !contractNumbers.length) {
        console.log(
          `  ✗ listing failed — stop; resume later at: ${lastResumeHint}`
        );
        break;
      }

      const blockByNumber = new Map(contractBlocks.map((b) => [b.contract_number, b]));

      console.log(`  GeM page contracts: ${contractNumbers.length} (listed=${expected})`);

      const beforeStats = await getContractsDoneStats(client, contractNumbers);
      const missingCount = Math.max(0, contractNumbers.length - beforeStats.total);
      if (beforeStats.done > 0 || missingCount > 0 || beforeStats.pending > 0) {
        let resumeAt = '';
        if (beforeStats.pendingNumbers.length) {
          const num = beforeStats.pendingNumbers[0];
          const idx = contractNumbers.indexOf(num);
          resumeAt = `[${idx >= 0 ? idx + 1 : '?'}] ${num}`;
        } else if (missingCount > 0) {
          for (let i = 0; i < contractNumbers.length; i++) {
            const row = await loadContractByNumber(client, contractNumbers[i]);
            if (!row) {
              resumeAt = `[${i + 1}] ${contractNumbers[i]}`;
              break;
            }
          }
        }
        console.log(
          `  resume: done=${beforeStats.done}/${contractNumbers.length} pending=${beforeStats.pending} missing_in_db=${missingCount}` +
            (resumeAt ? ` → continue at ${resumeAt}` : '')
        );
      }

      // Enrich pending contracts on this page only
      let pageErrors = 0;
      let hitLimit = false;
      for (let i = 0; i < contractNumbers.length; i++) {
        if (stopRequested) break;
        if (cli.limit > 0 && processed >= cli.limit) {
          hitLimit = true;
          break;
        }
        const num = contractNumbers[i];
        let row = await loadContractByNumber(client, num);
        if (!row) {
          const block = blockByNumber.get(num);
          if (!block) {
            console.log(
              `  [${i + 1}/${contractNumbers.length}] ${num} — not in new_contracts and no listing block (skip)`
            );
            pageErrors += 1;
            continue;
          }
          console.log(
            `  [${i + 1}/${contractNumbers.length}] ${num} — missing in DB → insert from listing`
          );
          try {
            await ensureListingContract(client, { stateId: page.state_id, block });
            row = await loadContractByNumber(client, num);
          } catch (err) {
            errors += 1;
            pageErrors += 1;
            console.log(`      insert failed: ${err.message}`);
            continue;
          }
          if (!row) {
            errors += 1;
            pageErrors += 1;
            console.log(`      insert failed: row still missing`);
            continue;
          }
        }
        if (!cli.resync && row.seller_id && row.buyer_id) {
          skippedDone += 1;
          console.log(`  [${i + 1}/${contractNumbers.length}] ${num} — already scraped (skip)`);
          continue;
        }

        processed += 1;
        lastResumeHint = `${pageLabel(page)} contract=${num}`;
        console.log(`  [${i + 1}/${contractNumbers.length}] ${num}`);
        try {
          cookieRef.cookie = await getCookie();
          await enrichStateContract({ client, s3, row, cookieRef, delayMs });
          saved += 1;
        } catch (err) {
          errors += 1;
          pageErrors += 1;
          console.log(`      failed: ${err.message}`);
          // keep going — other contracts on this page still progress; page stays open
        }
      }

      if (stopRequested) {
        console.log(`  — stop requested; is_scraped stays FALSE`);
        console.log(`  RESUME POINT: ${lastResumeHint}`);
        break;
      }

      if (hitLimit) {
        console.log(
          `  — limit reached mid-page; is_scraped stays FALSE`
        );
        console.log(`  RESUME POINT: ${lastResumeHint}`);
        break;
      }

      const stats = await getContractsDoneStats(client, contractNumbers);
      const complete = isPageComplete(stats, contractNumbers, pageErrors);

      if (complete) {
        await markPageScraped(client, page.page_id, contractNumbers.length);
        pagesDone += 1;
        console.log(
          `  ✓ page ${page.page_number} is_scraped = TRUE (${stats.done}/${contractNumbers.length}, listed=${expected})`
        );
      } else {
        console.log(
          `  ✗ page ${page.page_number} incomplete: done=${stats.done}/${contractNumbers.length} pending=${stats.pending} linked=${stats.total} listed=${expected} errors=${pageErrors}`
        );
        console.log(`  RESUME POINT: ${lastResumeHint}`);
        console.log(`  — stop here; next run resumes this same page (skips already-scraped contracts)`);
        break;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(
    `\nAll done! PagesDone=${pagesDone} Processed=${processed} Saved=${saved} SkippedDone=${skippedDone} Errors=${errors}`
  );
  if (stopRequested || errors > 0 || (pages.length && pagesDone < pages.length)) {
    console.log(`Next start resumes at: ${lastResumeHint || '(re-check is_scraped=FALSE pages)'}`);
  }
}

async function runForever() {
  for (;;) {
    try {
      await main();
      break;
    } catch (err) {
      console.error(`fatal: ${err.message || err}`);
      console.log(`auto-restart script in ${Math.round(FATAL_RESTART_MS / 1000)}s...`);
      await sleep(FATAL_RESTART_MS);
      stopRequested = false;
    }
  }
}

runForever().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
