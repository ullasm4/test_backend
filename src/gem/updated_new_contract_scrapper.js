/**
 * Enrich new_contracts page-by-page (contracts_scrapper-style):
 *   1. Load state_wise_contract_list_pages WHERE is_scraped=FALSE
 *   2. Re-fetch GeM listing page → contract blocks
 *   3. Only enrich when seller_id OR buyer_id is NULL
 *      (order_id → PDF → S3 → seller/buyer — same as contracts_scrapper.js)
 *   4. When all contracts on page have seller_id + buyer_id → is_scraped=TRUE
 *   5. Incomplete pages stay open; continue to next page (no infinite PDF wait)
 *
 *   Contracts within a page are enriched with bounded concurrency
 *   (--concurrency=N, default 3) instead of strictly one at a time.
 *
 *   node src/gem/new_contract_scrapped.js
 *   node src/gem/new_contract_scrapped.js --state "Gujarat" --delay-3
 *   node src/gem/new_contract_scrapped.js --state "Gujarat" --start-page 0 --end-page 10
 *   node src/gem/new_contract_scrapped.js --state "Gujarat" --pages 1-50
 *   node src/gem/new_contract_scrapped.js --contract GEMC-511687790081951
 *   node src/gem/new_contract_scrapped.js --parts=10 --part=1
 *   node src/gem/new_contract_scrapped.js --limit 5
 *   node src/gem/new_contract_scrapped.js --concurrency 5
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
const PDF_BASE = 'https://fulfilment.gem.gov.in/contract/fds';

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const REQUEST_TIMEOUT_MS = 120000;
const TIMEOUT_COOLDOWN_MS = 60000;
const LONG_COOLDOWN_MS = 180000;
const COOKIE_REFRESH_EVERY = 3;
const FATAL_RESTART_MS = 30000;
const DEFAULT_CONCURRENCY = 3;
const CONTRACT_RETRY_ATTEMPTS = 2; // bounded retries for per-contract network calls
const DB_RETRY_COOLDOWN_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set by SIGINT/SIGTERM — finish in-flight contracts, then stop (page stays resumable). */
let stopRequested = false;

function installStopHandlers() {
  const onStop = (sig) => {
    if (stopRequested) {
      console.log(`\n${sig} again — forcing exit`);
      process.exit(1);
    }
    stopRequested = true;
    console.log(`\n${sig} received — will stop after in-flight contracts (safe to resume later)`);
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
    startPage: null,
    endPage: null,
    concurrency: DEFAULT_CONCURRENCY,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);
    const pagesRange = a.match(/^--pages(?:=|\s+)(\d+)\s*-\s*(\d+)$/);
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--reverse') out.reverse = true;
    else if (a === '--resync') out.resync = true;
    else if (delayMatch) out.delaySec = Number(delayMatch[1]);
    else if (partSlash) {
      out.part = Number(partSlash[1]);
      out.parts = Number(partSlash[2]);
    } else if (a.startsWith('--pages=')) {
      const m = a.slice(8).match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) throw new Error('Use --pages=START-END (e.g. --pages=0-10)');
      out.startPage = Number(m[1]);
      out.endPage = Number(m[2]);
    } else if (a === '--pages') {
      const val = argv[++i] ?? '';
      const m = String(val).match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) throw new Error('Use --pages START-END (e.g. --pages 0-10)');
      out.startPage = Number(m[1]);
      out.endPage = Number(m[2]);
    } else if (
      a === '--delay' ||
      a === '--state' ||
      a === '--name' ||
      a === '--contract' ||
      a === '--part' ||
      a === '--parts' ||
      a === '--limit' ||
      a === '--concurrency' ||
      a === '--start-page' ||
      a === '--end-page' ||
      a === '--from-page' ||
      a === '--to-page'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else if (key === 'limit') out.limit = Number(val);
      else if (key === 'concurrency') out.concurrency = Number(val);
      else if (key === 'state' || key === 'name') out.state = val;
      else if (key === 'contract') out.contract = val;
      else if (key === 'start-page' || key === 'from-page') out.startPage = Number(val);
      else if (key === 'end-page' || key === 'to-page') out.endPage = Number(val);
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--state=')) out.state = a.slice(8);
    else if (a.startsWith('--name=')) out.state = a.slice(7);
    else if (a.startsWith('--contract=')) out.contract = a.slice(11);
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a.startsWith('--concurrency=')) out.concurrency = Number(a.slice(14));
    else if (a.startsWith('--start-page=')) out.startPage = Number(a.slice(13));
    else if (a.startsWith('--from-page=')) out.startPage = Number(a.slice(12));
    else if (a.startsWith('--end-page=')) out.endPage = Number(a.slice(11));
    else if (a.startsWith('--to-page=')) out.endPage = Number(a.slice(10));
    else if (pagesRange) {
      out.startPage = Number(pagesRange[1]);
      out.endPage = Number(pagesRange[2]);
    }
  }
  if (Number.isNaN(out.delaySec) || out.delaySec < 0) out.delaySec = 0;
  if (Number.isNaN(out.part) || out.part < 0) out.part = 0;
  if (Number.isNaN(out.parts) || out.parts < 0) out.parts = 0;
  if (Number.isNaN(out.limit) || out.limit < 0) out.limit = 0;
  if (Number.isNaN(out.concurrency) || out.concurrency < 1) out.concurrency = DEFAULT_CONCURRENCY;
  if (out.startPage != null && Number.isNaN(out.startPage)) out.startPage = null;
  if (out.endPage != null && Number.isNaN(out.endPage)) out.endPage = null;
  if (out.startPage != null && out.endPage != null && out.startPage > out.endPage) {
    throw new Error(`--start-page (${out.startPage}) must be <= --end-page (${out.endPage})`);
  }
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

/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 * Each worker instance pulls the next unclaimed index synchronously
 * (no await between claim and increment), so items are never double-processed.
 */
async function mapWithConcurrency(items, limit, worker) {
  let idx = 0;
  const n = Math.max(1, Math.min(limit || 1, items.length || 1));
  async function runner() {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: n }, runner));
}

function createPool(concurrency = DEFAULT_CONCURRENCY) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 60000,
    // Enough connections for all concurrent contract workers plus headroom
    // for the page-level bookkeeping queries running alongside them.
    max: Math.max(10, concurrency + 5),
  });
  // Prevent process crash on idle client disconnects
  pool.on('error', (err) => {
    console.log(`db pool error (ignored): ${err.message}`);
  });
  return pool;
}

function isDbConnectionError(err) {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ECONNREFUSED' ||
    code === '57P01' || // admin_shutdown
    code === '57P02' || // crash_shutdown
    code === '57P03' || // cannot_connect_now
    code === '08000' ||
    code === '08003' ||
    code === '08006' ||
    /Connection terminated/i.test(msg) ||
    /connection timeout/i.test(msg) ||
    /Client has encountered a connection error/i.test(msg) ||
    /not queryable/i.test(msg) ||
    /Cannot use a pool after calling end/i.test(msg)
  );
}

/**
 * Query via the pool directly (pg.Pool grabs/returns a connection per call,
 * so this is safe to call concurrently from multiple workers — unlike a
 * single manually-held Client). One retry on transient connection errors.
 */
async function dbQuery(pool, text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (isDbConnectionError(err)) {
      console.log(`  db retry after: ${err.message}`);
      await sleep(DB_RETRY_COOLDOWN_MS);
      return pool.query(text, params);
    }
    throw err;
  }
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

async function loadUnscrapedPages(pool, { state = '', startPage = null, endPage = null } = {}) {
  const params = [];
  const where = ['p.is_scraped = FALSE'];
  if (state) {
    params.push(state);
    where.push(`lower(s.name) = lower($${params.length})`);
  }
  if (startPage != null) {
    params.push(startPage);
    where.push(`p.page_number >= $${params.length}`);
  }
  if (endPage != null) {
    params.push(endPage);
    where.push(`p.page_number <= $${params.length}`);
  }
  const { rows } = await dbQuery(
    pool,
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

async function loadContractByNumber(pool, contractNumber) {
  const { rows } = await dbQuery(
    pool,
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
  const { rows } = await dbQuery(
    pool,
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
async function getContractsDoneStats(pool, contractNumbers) {
  if (!contractNumbers.length) return { total: 0, done: 0, pending: 0, pendingNumbers: [] };
  const { rows } = await dbQuery(
    pool,
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE seller_id IS NOT NULL AND buyer_id IS NOT NULL)::int AS done,
       COUNT(*) FILTER (WHERE seller_id IS NULL OR buyer_id IS NULL)::int AS pending,
       COALESCE(
         array_agg(contract_number ORDER BY contract_number)
           FILTER (WHERE seller_id IS NULL OR buyer_id IS NULL),
         ARRAY[]::text[]
       ) AS pending_numbers
     FROM new_contracts
     WHERE contract_number = ANY($1::text[])`,
    [contractNumbers]
  );
  return {
    total: rows[0]?.total || 0,
    done: rows[0]?.done || 0,
    pending: rows[0]?.pending || 0,
    pendingNumbers: rows[0]?.pending_numbers || [],
  };
}

function pageLabel(page) {
  return `${page.state_name} ${page.from_date}→${page.to_date} p=${page.page_number}`;
}

/** First unscraped page (DB-only peek). */
function getResumeCursor(pages) {
  if (!pages.length) return null;
  const first = pages[0];
  return {
    page: first,
    label: pageLabel(first),
  };
}

async function markPageScraped(pool, pageId, totalContracts = null) {
  await dbQuery(
    pool,
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
function isPageComplete(stats, contractNumbers) {
  return (
    contractNumbers.length > 0 &&
    stats.pending === 0 &&
    stats.total === contractNumbers.length &&
    stats.done === stats.total
  );
}

function needsEnrich(row, resync) {
  if (resync) return true;
  if (!row) return true;
  return !row.seller_id || !row.buyer_id;
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

async function resolveMinistryId(pool, ministryLabel) {
  const name = String(ministryLabel || '').trim();
  if (!name) return null;
  const existing = await dbQuery(
    pool,
    `SELECT id FROM contract_ministry WHERE lower(name) = lower($1) LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  try {
    const inserted = await dbQuery(
      pool,
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
async function ensureListingContract(pool, { stateId, block }) {
  const contractNumber = String(block.contract_number || '').trim();
  if (!contractNumber) return null;

  const existing = await dbQuery(
    pool,
    `SELECT id FROM new_contracts WHERE contract_number = $1 LIMIT 1`,
    [contractNumber]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const ministryId = await resolveMinistryId(pool, block.ministry_label);
  const contractDate = parseGemContractDate(block.contract_date);
  const products = Array.isArray(block.products_from_html) ? block.products_from_html : [];
  const buyingMode = block.buying_mode ? normalizeBuyingMode(block.buying_mode) : null;

  try {
    const inserted = await dbQuery(
      pool,
      `INSERT INTO new_contracts (
         state_id, ministry_id, contract_number, org_type, org_name,
         total_value, department, office_zone, status_of_the_contract,
         products, contract_date, bid_number, buyer_designation, buying_mode
       ) VALUES (
         $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9,
         $10::jsonb, $11::date, $12, $13, $14
       )
       ON CONFLICT (contract_number) DO NOTHING
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
    if (inserted.rows[0]) return inserted.rows[0].id;
  } catch {
    /* fall through to re-select below (e.g. race with another worker) */
  }
  // Another concurrent worker may have inserted it between our check and insert.
  const recheck = await dbQuery(
    pool,
    `SELECT id FROM new_contracts WHERE contract_number = $1 LIMIT 1`,
    [contractNumber]
  );
  return recheck.rows[0]?.id || null;
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

/**
 * Bounded retry for per-contract network calls. Unlike fetchListingPage's
 * infinite retry (one page, must eventually succeed), a single contract
 * should give up after a couple of tries so one bad contract can't stall
 * the whole run — it's simply left for the next pass (seller/buyer stay NULL).
 */
async function withRetry(fn, { retries = CONTRACT_RETRY_ATTEMPTS, label = '' } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err) || attempt >= retries) throw err;
      attempt += 1;
      console.log(`      ${label} retry ${attempt}/${retries}: ${err.message}`);
      await sleep(TIMEOUT_COOLDOWN_MS);
    }
  }
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

/**
 * GeM sbtCaptcha responses:
 *   success: {"status":"1","code":"<a href=\"https://fulfilment.gem.gov.in/contract/fds?orderId=TOKEN\">..."}
 *   failure: {"status":"0"}
 * Real order ids look like base64 (e.g. dU03SHFpYzRpVHVsQ2M3V0U5dWFoQT09).
 */
function normalizeOrderId(raw) {
  let orderId = String(raw ?? '').trim();
  if (!orderId) return '';

  if (orderId.startsWith('{') || orderId.startsWith('[')) {
    try {
      const j = JSON.parse(orderId);
      // Prefer explicit id fields; `code` often holds an HTML <a href="...?orderId=...">
      const extracted =
        j?.orderId || j?.order_id || j?.data || j?.oid || j?.code || '';
      if (extracted) {
        orderId = String(extracted).trim();
      } else if (j?.status === '0' || j?.status === 0) {
        return '';
      }
    } catch {
      /* keep */
    }
  }

  const fromQuery = orderId.match(/[?&]orderId=([^&\s"'<>]+)/i);
  if (fromQuery) orderId = fromQuery[1];
  orderId = orderId.replace(/^orderId=/i, '').replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  orderId = orderId.replace(/\\+/g, '');

  const token = orderId.match(/[A-Za-z0-9+/=]{16,}/);
  return token ? token[0] : '';
}

async function fetchOrderId(contractNumber, cookie, delayMs) {
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

async function downloadPdf(orderId, delayMs) {
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

async function downloadPdfFromUrl(pdfUrl, delayMs) {
  const { data, status, headers } = await axios.get(pdfUrl, {
    headers: { Accept: 'application/pdf,*/*', 'User-Agent': UA },
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  if (delayMs > 0) await sleep(delayMs);
  if (status >= 400) throw new Error(`PDF url HTTP ${status}`);
  const buf = Buffer.from(data);
  const ctype = String(headers['content-type'] || '');
  if (buf.length < 100 || (ctype.includes('html') && buf.slice(0, 20).toString().includes('<'))) {
    throw new Error('PDF url did not return a valid PDF file');
  }
  return buf;
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

/**
 * Same enrich flow as contracts_scrapper.js:
 * order_id → PDF → S3 → parse → seller/buyer on new_contracts
 * Call only when seller_id or buyer_id is null (unless --resync).
 * Safe to run concurrently for different contracts — takes `pool`, not a
 * shared client, and its own `cookie` copy (refreshed locally on retry).
 */
async function enrichStateContract({ pool, s3, row, cookie, delayMs, block }) {
  const contractNumber = row.contract_number;
  const listingBlock = block || rowToBlock(row);

  let orderId = normalizeOrderId(row.order_id);
  if (row.id && row.order_id && orderId && row.order_id !== orderId) {
    await updateNewContractOrderAndPdf(pool, row.id, orderId, null);
  }
  if (!orderId) {
    orderId = await withRetry(() => fetchOrderId(contractNumber, cookie, delayMs), {
      label: `${contractNumber} order_id`,
    });
    await updateNewContractOrderAndPdf(pool, row.id, orderId, null);
    console.log(`      ${contractNumber} order_id obtained`);
  } else {
    console.log(`      ${contractNumber} order_id already exists`);
  }

  let pdfUrl = row.contract_pdf_url;
  let pdfBuf = null;
  if (!pdfUrl) {
    pdfBuf = await withRetry(() => downloadPdf(orderId, delayMs), {
      label: `${contractNumber} pdf`,
    });
    pdfUrl = await uploadPdfToS3(s3, pdfBuf, contractNumber);
    await updateNewContractOrderAndPdf(pool, row.id, orderId, pdfUrl);
    console.log(`      ${contractNumber} pdf uploaded to S3`);
  } else {
    console.log(`      ${contractNumber} pdf url exists — fetch stored url`);
    try {
      pdfBuf = await withRetry(() => downloadPdfFromUrl(pdfUrl, delayMs), {
        label: `${contractNumber} stored pdf`,
      });
    } catch (err) {
      console.log(`      ${contractNumber} stored pdf failed (${err.message}) — fallback GeM`);
      pdfBuf = await withRetry(() => downloadPdf(orderId, delayMs), {
        label: `${contractNumber} pdf fallback`,
      });
    }
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

  // Seller Details → false; Service Provider Details → true
  const isService = Boolean(parsed.is_service);

  await saveScrapedContract(pool, {
    existingId: row.id,
    ministryId: row.ministry_id || null,
    stateId: row.state_id,
    block: listingBlock,
    parsed,
    seller,
    buyer,
    orderId,
    pdfUrl,
    isService,
  });
  console.log(
    `      ${contractNumber} saved → is_service=${isService} seller="${seller.company_name || seller.seller_id}" buyer="${buyer.company_name || buyer.email}"`
  );
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`
State-wise enricher (same enrich flow as contracts_scrapper.js):
  Target only new_contracts where seller_id OR buyer_id is NULL
  → captcha → PDF → S3 → seller/buyer (up to --concurrency contracts at once)
  → when page fully done → is_scraped=TRUE
  Incomplete pages stay open; script continues to next page.

  node src/gem/new_contract_scrapped.js
  node src/gem/new_contract_scrapped.js --state "Gujarat" --delay-3
  node src/gem/new_contract_scrapped.js --state "Gujarat" --start-page 0 --end-page 10
  node src/gem/new_contract_scrapped.js --state "Gujarat" --pages 1-50
  node src/gem/new_contract_scrapped.js --contract GEMC-...
  node src/gem/new_contract_scrapped.js --resync
  node src/gem/new_contract_scrapped.js --limit 5
  node src/gem/new_contract_scrapped.js --concurrency 5
`);
    return;
  }

  installStopHandlers();

  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const pool = createPool(cli.concurrency);
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
    try {
      await mapWithConcurrency(rows, cli.concurrency, async (row) => {
        if (stopRequested) return;
        console.log(`\n======== ${row.contract_number} ========`);
        try {
          await enrichStateContract({
            pool,
            s3,
            row,
            cookie: cookieRef.cookie,
            delayMs,
          });
        } catch (err) {
          console.log(`      ${row.contract_number} failed: ${err.message}`);
          try {
            cookieRef.cookie = await getCookie();
          } catch {
            /* ignore */
          }
        }
      });
    } finally {
      await pool.end();
    }
    console.log(stopRequested ? '\nStopped (safe to re-run same --contract)' : '\nAll done');
    return;
  }

  let pages = await loadUnscrapedPages(pool, {
    state: cli.state.trim(),
    startPage: cli.startPage,
    endPage: cli.endPage,
  });
  if (!pages.length) {
    const rangeHint =
      cli.startPage != null || cli.endPage != null
        ? ` in page range ${cli.startPage ?? '*'}–${cli.endPage ?? '*'}`
        : '';
    console.log(`No unscraped pages (is_scraped = FALSE)${rangeHint}`);
    await pool.end();
    return;
  }
  if (cli.reverse) pages = [...pages].reverse();
  if (cli.part || cli.parts) {
    const before = pages.length;
    pages = slicePart(pages, cli.part, cli.parts);
    console.log(`Part: ${cli.part}/${cli.parts} (${pages.length} of ${before} pages)`);
  }

  const resume = getResumeCursor(pages);

  console.log(`Mode: contracts_scrapper-style enrich (only seller_id/buyer_id NULL)`);
  console.log(`Pages: ${pages.length}`);
  console.log(`State filter: ${cli.state || 'all'}`);
  console.log(
    `Page range: ${cli.startPage != null || cli.endPage != null ? `${cli.startPage ?? '*'}–${cli.endPage ?? '*'}` : 'all'}`
  );
  console.log(`Limit: ${cli.limit || 'none'}`);
  console.log(`Concurrency: ${cli.concurrency}`);
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
        console.log(`  page empty/status=${status} — leave open, next page`);
        continue;
      }

      const contractBlocks = parseContractBlocks(data);
      const contractNumbers = contractBlocks.length
        ? [...new Set(contractBlocks.map((b) => b.contract_number))]
        : parseContractNumbersFromHtml(data);

      if (!contractNumbers.length) {
        console.log(`  no contracts on page — leave open, next page`);
        continue;
      }

      const blockByNumber = new Map(contractBlocks.map((b) => [b.contract_number, b]));
      console.log(
        `  page contracts=${contractNumbers.length} (listed=${expected}) — up to ${cli.concurrency} in parallel`
      );

      let hitLimit = false;

      await mapWithConcurrency(contractNumbers, cli.concurrency, async (num, i) => {
        if (stopRequested) return;
        if (cli.limit > 0 && processed >= cli.limit) {
          hitLimit = true;
          return;
        }

        const block = blockByNumber.get(num) || { contract_number: num };

        let row;
        try {
          row = await loadContractByNumber(pool, num);
        } catch (err) {
          errors += 1;
          console.log(`    [${i + 1}/${contractNumbers.length}] ${num} db failed: ${err.message}`);
          return;
        }

        // Only target seller_id / buyer_id NULL (contracts_scrapper skip-complete style)
        if (row && !needsEnrich(row, cli.resync)) {
          skippedDone += 1;
          return;
        }

        if (!row) {
          try {
            await ensureListingContract(pool, { stateId: page.state_id, block });
            row = await loadContractByNumber(pool, num);
          } catch (err) {
            errors += 1;
            console.log(`    [${i + 1}/${contractNumbers.length}] ${num} insert failed: ${err.message}`);
            return;
          }
          if (!row) {
            errors += 1;
            console.log(`    [${i + 1}/${contractNumbers.length}] ${num} still missing after insert`);
            return;
          }
        }

        if (cli.limit > 0 && processed >= cli.limit) {
          hitLimit = true;
          return;
        }
        processed += 1;
        lastResumeHint = `${pageLabel(page)} contract=${num}`;
        console.log(`    [${processed}] ${num} (seller/buyer null)`);

        try {
          if (row.order_id || row.contract_pdf_url) {
            console.log(`      ${num} resume enrich (incomplete)`);
          }
          await enrichStateContract({
            pool,
            s3,
            row,
            cookie: cookieRef.cookie,
            delayMs,
            block,
          });
          saved += 1;
        } catch (err) {
          errors += 1;
          console.log(`      ${num} save failed: ${err.message}`);
          try {
            cookieRef.cookie = await getCookie();
          } catch {
            /* ignore */
          }
        }
      });

      if (stopRequested) {
        console.log(`  — stop requested; is_scraped stays FALSE`);
        break;
      }
      if (hitLimit) {
        console.log(`  pause: --limit reached, leaving is_scraped = FALSE`);
        break;
      }

      try {
        const stats = await getContractsDoneStats(pool, contractNumbers);
        if (isPageComplete(stats, contractNumbers)) {
          await markPageScraped(pool, page.page_id, contractNumbers.length);
          pagesDone += 1;
          console.log(`  ✓ is_scraped = TRUE (${stats.done}/${contractNumbers.length})`);
        } else {
          console.log(
            `  leave open: done=${stats.done}/${contractNumbers.length} pending=${stats.pending} — continue next page`
          );
        }
      } catch (err) {
        console.log(`  page finalize db failed: ${err.message} — leave open, next page`);
      }
    }
  } finally {
    await pool.end();
  }

  console.log(
    `\nAll done! PagesDone=${pagesDone} Processed=${processed} Saved=${saved} SkippedDone=${skippedDone} Errors=${errors}`
  );
  if (lastResumeHint) console.log(`Last work: ${lastResumeHint}`);
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