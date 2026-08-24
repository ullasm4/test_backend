/**
 * Enrich new_contracts from stored contract_pdf_url (preferred) or GeM PDF:
 *   1. Load contracts needing seller_id / buyer_id
 *   2. If contract_pdf_url exists → download PDF from URL → parse → store
 *   3. Else order_id → GeM PDF → S3 → parse → store
 *   4. Supports goods (Seller/Product Details) and services (Service Provider/Service Details)
 *
 *   node src/gem/url_to_contract_scrapped\ copy.js
 *   node src/gem/url_to_contract_scrapped\ copy.js --state "Gujarat" --delay-3
 *   node src/gem/url_to_contract_scrapped\ copy.js --contract GEMC-511687723125583
 *   node src/gem/url_to_contract_scrapped\ copy.js --contract-date 01-2024 --state "Gujarat"
 *   node src/gem/url_to_contract_scrapped\ copy.js --limit 5
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
// const PDF_BASE = 'https://fulfillment.gem.gov.in/contract/fds';
const PDF_BASE = 'https://fulfilment.gem.gov.in/contract/fds';

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const REQUEST_TIMEOUT_MS = 120000;
const TIMEOUT_COOLDOWN_MS = 60000;
const LONG_COOLDOWN_MS = 180000;
const COOKIE_REFRESH_EVERY = 3;
const FATAL_RESTART_MS = 30000;
const EMPTY_LISTING_RETRIES = 3;

/** Finite PDF download retries (never infinite). Backoff per failed attempt. */
const PDF_MAX_ATTEMPTS = 5;
const PDF_BACKOFF_MS = [2000, 4000, 8000, 15000, 15000];
const PDF_MIN_BYTES = 100;

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
    /** Raw --contract-date value (day or month) */
    contractDate: '',
    startPage: null,
    endPage: null,
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
      a === '--contract-date' ||
      a === '--contract_date' ||
      a === '--date' ||
      a === '--part' ||
      a === '--parts' ||
      a === '--limit' ||
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
      else if (key === 'state' || key === 'name') out.state = val;
      else if (key === 'contract') out.contract = val;
      else if (key === 'contract-date' || key === 'contract_date' || key === 'date') {
        out.contractDate = val;
      } else if (key === 'start-page' || key === 'from-page') out.startPage = Number(val);
      else if (key === 'end-page' || key === 'to-page') out.endPage = Number(val);
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--state=')) out.state = a.slice(8);
    else if (a.startsWith('--name=')) out.state = a.slice(7);
    else if (a.startsWith('--contract-date=')) out.contractDate = a.slice(16);
    else if (a.startsWith('--contract_date=')) out.contractDate = a.slice(16);
    else if (a.startsWith('--date=')) out.contractDate = a.slice(7);
    else if (a.startsWith('--contract=')) out.contract = a.slice(11);
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
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
  if (out.startPage != null && Number.isNaN(out.startPage)) out.startPage = null;
  if (out.endPage != null && Number.isNaN(out.endPage)) out.endPage = null;
  if (out.startPage != null && out.endPage != null && out.startPage > out.endPage) {
    throw new Error(`--start-page (${out.startPage}) must be <= --end-page (${out.endPage})`);
  }
  if (out.part || out.parts) {
    if (!out.parts || out.parts < 1) {
      throw new Error('Use --parts=N with --part=K (e.g. --parts=2 --part=1)');
    }
    if (!out.part || out.part < 1 || out.part > out.parts) {
      throw new Error(`--part must be between 1 and ${out.parts}`);
    }
  }
  return out;
}

/**
 * Parse --contract-date into ISO date range { from, to } (YYYY-MM-DD).
 * Accepts:
 *   DD-MM-YYYY | YYYY-MM-DD          → single day
 *   MM-YYYY | YYYY-MM | MM/YYYY      → full calendar month
 */
function parseContractDateArg(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return { from: iso, to: iso, label: iso };
  }

  // DD-MM-YYYY
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const iso = `${m[3]}-${mm}-${dd}`;
    return { from: iso, to: iso, label: iso };
  }

  // MM-YYYY or MM/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) {
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) throw new Error(`Invalid --contract-date month: ${s}`);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to, label: `${String(month).padStart(2, '0')}-${year}` };
  }

  // YYYY-MM
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error(`Invalid --contract-date month: ${s}`);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const last = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to, label: `${String(month).padStart(2, '0')}-${year}` };
  }

  throw new Error(
    `Invalid --contract-date "${s}" (use DD-MM-YYYY, YYYY-MM-DD, or MM-YYYY e.g. 15-01-2024 / 01-2024)`
  );
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

async function loadContractsFlat(
  pool,
  { state = '', contract = '', contractDateFrom = '', contractDateTo = '', resync = false } = {}
) {
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
  if (contractDateFrom && contractDateTo) {
    if (contractDateFrom === contractDateTo) {
      params.push(contractDateFrom);
      where.push(`c.contract_date = $${params.length}::date`);
    } else {
      params.push(contractDateFrom);
      where.push(`c.contract_date >= $${params.length}::date`);
      params.push(contractDateTo);
      where.push(`c.contract_date <= $${params.length}::date`);
    }
  } else if (contractDateFrom) {
    params.push(contractDateFrom);
    where.push(`c.contract_date = $${params.length}::date`);
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
     ORDER BY c.contract_date ASC NULLS LAST, c.created_at ASC, c.contract_number ASC`,
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

/** Transient network/DNS + invalid PDF body — not permanent HTTP 4xx/5xx. */
function isRetryablePdfError(err) {
  if (err?.httpStatus != null && err.httpStatus >= 400) return false;
  if (err?.code === 'INVALID_PDF' || err?.retryable === true) return true;
  return isRetryableError(err);
}

function pdfErrorCode(err) {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');
  if (code && code !== 'INVALID_PDF') return code;
  const fromMsg = msg.match(
    /\b(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ECONNABORTED)\b/i
  );
  if (fromMsg) return fromMsg[1].toUpperCase();
  if (code === 'INVALID_PDF') return 'INVALID_PDF';
  if (err?.httpStatus) return `HTTP_${err.httpStatus}`;
  return code || 'ERROR';
}

function pdfErrorHost(err) {
  const msg = String(err?.message || err || '');
  const m = msg.match(/ENOTFOUND\s+(\S+)/i) || msg.match(/getaddrinfo\s+\S+\s+(\S+)/i);
  return m?.[1] || '';
}

/** Short label for retry logs: `ENOTFOUND fulfillment.gem.gov.in` */
function formatPdfRetryLabel(err) {
  const code = pdfErrorCode(err);
  const host = pdfErrorHost(err);
  if (code === 'ENOTFOUND' && host) return `ENOTFOUND ${host}`;
  if (host && /ENOTFOUND|EAI_AGAIN/i.test(code)) return `${code} ${host}`;
  const msg = String(err?.message || err || '').replace(/\s+/g, ' ').trim();
  if (code && code !== 'ERROR') return code;
  return msg.slice(0, 80) || 'ERROR';
}

function stageError(stage, err) {
  const e = new Error(err?.message || String(err));
  e.stage = stage;
  e.code = err?.code || pdfErrorCode(err);
  e.httpStatus = err?.httpStatus;
  e.cause = err;
  return e;
}

function logEnrichFailure(err) {
  const stage = err?.stage || 'enrich';
  const code = pdfErrorCode(err);
  const msg = String(err?.message || err || '').replace(/\s+/g, ' ').trim();
  console.log(`      ${stage} failed: ${code} — ${msg}`);
  if (code === 'ENOTFOUND' || /ENOTFOUND/i.test(msg)) {
    const host = pdfErrorHost(err) || 'fulfillment.gem.gov.in';
    console.log(`      DNS failure for ${host} — leaving contract pending`);
  } else if (stage === 'pdf') {
    console.log(`      leaving contract pending (seller/buyer unchanged)`);
  }
}

/**
 * Reject HTML/error pages and tiny buffers. Valid PDFs start with %PDF.
 * Marks INVALID_PDF as retryable (transient bad responses).
 */
function assertValidPdfBuffer(buf, headers = {}) {
  const length = buf?.length || 0;
  if (!buf || length < PDF_MIN_BYTES) {
    const e = new Error(`PDF too small (${length} bytes)`);
    e.code = 'INVALID_PDF';
    e.retryable = true;
    throw e;
  }
  const head = buf.slice(0, 8).toString('latin1');
  if (!head.startsWith('%PDF')) {
    const ctype = String(headers['content-type'] || '').toLowerCase();
    const preview = buf.slice(0, 120).toString('utf8').replace(/\s+/g, ' ').trim();
    const looksHtml =
      ctype.includes('html') ||
      /^<!doctype/i.test(preview) ||
      /^<html/i.test(preview) ||
      preview.includes('<');
    const e = new Error(
      looksHtml
        ? 'PDF endpoint returned HTML/error page instead of PDF'
        : `PDF missing %PDF magic (got: ${JSON.stringify(preview.slice(0, 40))})`
    );
    e.code = 'INVALID_PDF';
    e.retryable = true;
    throw e;
  }
}

/**
 * Finite exponential backoff around a single PDF fetch.
 * Logs: pdf:ENOTFOUND host — wait 2s (try 1/5)
 * Does not retry permanent HTTP errors (400/404/500).
 */
async function withPdfRetries(fetchOnce, delayMs) {
  let lastErr;
  for (let attempt = 1; attempt <= PDF_MAX_ATTEMPTS; attempt++) {
    try {
      const buf = await fetchOnce();
      if (delayMs > 0) await sleep(delayMs);
      return buf;
    } catch (err) {
      lastErr = err;
      if (!isRetryablePdfError(err)) throw err;
      const waitMs = PDF_BACKOFF_MS[attempt - 1] ?? 15000;
      console.log(
        `      pdf:${formatPdfRetryLabel(err)} — wait ${Math.round(waitMs / 1000)}s (try ${attempt}/${PDF_MAX_ATTEMPTS})`
      );
      if (attempt >= PDF_MAX_ATTEMPTS) throw err;
      await sleep(waitMs);
    }
  }
  throw lastErr;
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
  return withPdfRetries(async () => {
    const { data, status, headers } = await axios.get(
      `${PDF_BASE}?orderId=${encodeURIComponent(orderId)}`,
      {
        headers: { Accept: 'application/pdf,*/*', 'User-Agent': UA, Referer: LANDING },
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'arraybuffer',
        validateStatus: () => true,
      }
    );
    if (status >= 400) {
      const e = new Error(`PDF download HTTP ${status}`);
      e.httpStatus = status;
      e.code = `HTTP_${status}`;
      throw e;
    }
    const buf = Buffer.from(data);
    assertValidPdfBuffer(buf, headers);
    return buf;
  }, delayMs);
}

async function downloadPdfFromUrl(pdfUrl, delayMs) {
  return withPdfRetries(async () => {
    const { data, status, headers } = await axios.get(pdfUrl, {
      headers: { Accept: 'application/pdf,*/*', 'User-Agent': UA },
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    if (status >= 400) {
      const e = new Error(`PDF url HTTP ${status}`);
      e.httpStatus = status;
      e.code = `HTTP_${status}`;
      throw e;
    }
    const buf = Buffer.from(data);
    assertValidPdfBuffer(buf, headers);
    return buf;
  }, delayMs);
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
 * Prefer contract_pdf_url → download → parse → store seller/buyer.
 * Fallback: order_id → GeM PDF → S3 → parse → store.
 * Call only when seller_id or buyer_id is null (unless --resync).
 */
async function enrichStateContract({ client, s3, row, cookie, delayMs, block }) {
  const contractNumber = row.contract_number;
  const listingBlock = block || rowToBlock(row);

  let orderId = normalizeOrderId(row.order_id);
  if (row.id && row.order_id && orderId && row.order_id !== orderId) {
    await updateNewContractOrderAndPdf(client, row.id, orderId, null);
  }

  let pdfUrl = row.contract_pdf_url || null;
  let pdfBuf = null;

  // 1) Prefer stored contract_pdf_url (no captcha / GeM download needed)
  if (pdfUrl) {
    console.log(`      using contract_pdf_url`);
    try {
      pdfBuf = await downloadPdfFromUrl(pdfUrl, delayMs);
      console.log(`      pdf downloaded from stored URL`);
    } catch (err) {
      console.log(`      stored pdf failed (${err.message}) — fallback GeM if possible`);
      pdfBuf = null;
    }
  }

  // 2) Fallback: need order_id then download from GeM fulfillment
  if (!pdfBuf) {
    if (!orderId) {
      try {
        if (!cookie) {
          throw new Error('cookie required to fetch order_id');
        }
        orderId = await fetchOrderId(contractNumber, cookie, delayMs);
        await updateNewContractOrderAndPdf(client, row.id, orderId, null);
        console.log(`      order_id obtained`);
      } catch (err) {
        throw stageError('order_id', err);
      }
    } else {
      console.log(`      order_id already exists`);
    }

    try {
      pdfBuf = await downloadPdf(orderId, delayMs);
    } catch (err) {
      throw stageError('pdf', err);
    }

    try {
      pdfUrl = await uploadPdfToS3(s3, pdfBuf, contractNumber);
      await updateNewContractOrderAndPdf(client, row.id, orderId, pdfUrl);
      console.log(`      pdf uploaded to S3`);
    } catch (err) {
      throw stageError('s3 upload', err);
    }
  } else if (!orderId) {
    console.log(`      order_id skipped (pdf from contract_pdf_url)`);
  }

  let parsed;
  try {
    const pdfText = await extractPdfText(pdfBuf);
    parsed = parsePdfSections(pdfText);
  } catch (err) {
    throw stageError('pdf parse', err);
  }

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
      parsed.buyer_details.designation ||
      (parsed.buyer_details.address || '').split(',')[0] ||
      '',
    phone: parsed.buyer_details.contact_no,
    email: parsed.buyer_details.email,
    address: parsed.buyer_details.address,
    gst_number: parsed.buyer_details.gstin,
  };
  if (!seller.company_name && !seller.email && !seller.seller_id) {
    throw stageError('pdf parse', new Error('PDF parse produced empty seller details'));
  }

  // Prefer PDF-generated date when listing block has none
  if (!listingBlock.contract_date && parsed.generated_date) {
    listingBlock.contract_date = parsed.generated_date;
  }

  // Seller Details → false; Service Provider Details → true
  const isService = Boolean(parsed.is_service);

  try {
    await saveScrapedContract(client, {
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
  } catch (err) {
    throw stageError('database save', err);
  }
  console.log(
    `      saved → is_service=${isService} seller="${seller.company_name || seller.seller_id}" buyer="${buyer.company_name || buyer.email}"`
  );
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`
Enrich from contract_pdf_url (preferred) or GeM PDF:
  Target new_contracts where seller_id OR buyer_id is NULL
  → download PDF (stored URL first) → parse → seller/buyer
  Supports goods + service (Service Provider) PDF layouts.

  node src/gem/url_to_contract_scrapped\\ copy.js
  node src/gem/url_to_contract_scrapped\\ copy.js --state "Gujarat" --delay-3
  node src/gem/url_to_contract_scrapped\\ copy.js --contract GEMC-511687723125583
  node src/gem/url_to_contract_scrapped\\ copy.js --contract-date 01-2024 --state "Gujarat" --delay-3
  node src/gem/url_to_contract_scrapped\\ copy.js --resync
  node src/gem/url_to_contract_scrapped\\ copy.js --limit 5

  --state           Filter by states.name (case-insensitive)
  --contract-date   Filter new_contracts.contract_date
                    DD-MM-YYYY / YYYY-MM-DD = one day
                    MM-YYYY / YYYY-MM = full month (e.g. 01-2024)
                    Only rows with seller_id OR buyer_id NULL (unless --resync)
  --parts N         Split matching contracts/pages into N parts
  --part K          Run only part K (1..N); use with --parts
`);
    return;
  }

  installStopHandlers();

  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const pool = createPool();
  const s3 = createS3();
  const wantedContract = cli.contract.trim();
  const dateRange = cli.contractDate.trim()
    ? parseContractDateArg(cli.contractDate.trim())
    : null;

  // Flat DB mode: --contract and/or --contract-date → load from new_contracts directly
  if (wantedContract || dateRange) {
    let rows = await loadContractsFlat(pool, {
      state: cli.state.trim(),
      contract: wantedContract,
      contractDateFrom: dateRange?.from || '',
      contractDateTo: dateRange?.to || '',
      resync: cli.resync || Boolean(wantedContract),
    });

    if (!rows.length) {
      const bits = [];
      if (wantedContract) bits.push(`contract=${wantedContract}`);
      if (dateRange) {
        bits.push(
          dateRange.from === dateRange.to
            ? `contract_date=${dateRange.from}`
            : `contract_date=${dateRange.from}…${dateRange.to}`
        );
      }
      if (cli.state.trim()) bits.push(`state=${cli.state.trim()}`);
      if (!cli.resync && !wantedContract) bits.push('seller_id/buyer_id NULL');
      console.log(`No matching contracts (${bits.join(', ')})`);
      await pool.end();
      return;
    }

    if (cli.reverse) rows = [...rows].reverse();
    if (cli.part || cli.parts) {
      const before = rows.length;
      rows = slicePart(rows, cli.part, cli.parts);
      console.log(`Part: ${cli.part}/${cli.parts} (${rows.length} of ${before} contracts)`);
    }
    if (cli.limit > 0 && rows.length > cli.limit) {
      rows = rows.slice(0, cli.limit);
    }

    console.log(`Mode: flat new_contracts enrich (seller_id/buyer_id NULL)`);
    console.log(`Contracts: ${rows.length}`);
    console.log(`State filter: ${cli.state || 'all'}`);
    if (wantedContract) console.log(`Contract: ${wantedContract}`);
    if (dateRange) {
      console.log(
        dateRange.from === dateRange.to
          ? `Contract date: ${dateRange.from}`
          : `Contract date: ${dateRange.from} → ${dateRange.to} (${dateRange.label})`
      );
    }
    console.log(`Delay: ${delayMs > 0 ? `${cli.delaySec}s` : 'off'}`);
    console.log(`First: ${rows[0].contract_number} (${rows[0].contract_date || 'no date'})`);
    console.log(
      `Last:  ${rows[rows.length - 1].contract_number} (${rows[rows.length - 1].contract_date || 'no date'})\n`
    );

    const cookieRef = { cookie: await getCookie() };
    let processed = 0;
    let saved = 0;
    let errors = 0;
    let skippedDone = 0;
    let lastResumeHint = '';

    const client = await pool.connect();
    try {
      for (const row of rows) {
        if (stopRequested) break;

        // Re-check in case another worker finished it
        if (!needsEnrich(row, cli.resync || Boolean(wantedContract))) {
          skippedDone += 1;
          continue;
        }

        processed += 1;
        lastResumeHint = `${row.contract_number} date=${row.contract_date || '?'}`;
        console.log(
          `\n======== [${processed}/${rows.length}] ${row.contract_number} | date=${row.contract_date || '?'} | ${row.state_name || 'no-state'} ========`
        );

        try {
          cookieRef.cookie = await getCookie();
          if (row.order_id || row.contract_pdf_url) {
            console.log(`      resume enrich (incomplete)`);
          }
          await enrichStateContract({
            client,
            s3,
            row,
            cookie: cookieRef.cookie,
            delayMs,
          });
          saved += 1;
        } catch (err) {
          errors += 1;
          logEnrichFailure(err);
          try {
            cookieRef.cookie = await getCookie();
          } catch {
            /* ignore */
          }
        }
      }
    } finally {
      client.release();
      await pool.end();
    }

    console.log(
      `\nAll done! Processed=${processed} Saved=${saved} SkippedDone=${skippedDone} Errors=${errors}`
    );
    if (lastResumeHint) console.log(`Last work: ${lastResumeHint}`);
    if (stopRequested) console.log('Stopped (safe to re-run — incomplete rows stay pending)');
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

  const resume = await getResumeCursor(pool, pages);

  console.log(`Mode: contracts_scrapper-style enrich (only seller_id/buyer_id NULL)`);
  console.log(`Pages: ${pages.length}`);
  console.log(`State filter: ${cli.state || 'all'}`);
  console.log(
    `Page range: ${cli.startPage != null || cli.endPage != null ? `${cli.startPage ?? '*'}–${cli.endPage ?? '*'}` : 'all'}`
  );
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
      console.log(`  page contracts=${contractNumbers.length} (listed=${expected})`);

      let hitLimit = false;
      for (let i = 0; i < contractNumbers.length; i++) {
        if (stopRequested) break;
        if (cli.limit > 0 && processed >= cli.limit) {
          hitLimit = true;
          break;
        }

        const num = contractNumbers[i];
        const block = blockByNumber.get(num) || { contract_number: num };
        let row = await loadContractByNumber(client, num);

        // Only target seller_id / buyer_id NULL (contracts_scrapper skip-complete style)
        if (row && !needsEnrich(row, cli.resync)) {
          skippedDone += 1;
          continue;
        }

        if (!row) {
          try {
            await ensureListingContract(client, { stateId: page.state_id, block });
            row = await loadContractByNumber(client, num);
          } catch (err) {
            errors += 1;
            console.log(`    [${i + 1}/${contractNumbers.length}] ${num} insert failed: ${err.message}`);
            continue;
          }
          if (!row) {
            errors += 1;
            console.log(`    [${i + 1}/${contractNumbers.length}] ${num} still missing after insert`);
            continue;
          }
        }

        processed += 1;
        lastResumeHint = `${pageLabel(page)} contract=${num}`;
        console.log(`    [${processed}] ${num} (seller/buyer null)`);

        try {
          if (row.order_id || row.contract_pdf_url) {
            console.log(`      resume enrich (incomplete)`);
          }
          await enrichStateContract({
            client,
            s3,
            row,
            cookie: cookieRef.cookie,
            delayMs,
            block,
          });
          saved += 1;
        } catch (err) {
          errors += 1;
          logEnrichFailure(err);
          try {
            cookieRef.cookie = await getCookie();
          } catch {
            /* ignore */
          }
        }
      }

      if (stopRequested) {
        console.log(`  — stop requested; is_scraped stays FALSE`);
        break;
      }
      if (hitLimit) {
        console.log(`  pause: --limit reached, leaving is_scraped = FALSE`);
        break;
      }

      const stats = await getContractsDoneStats(client, contractNumbers);
      if (isPageComplete(stats, contractNumbers)) {
        await markPageScraped(client, page.page_id, contractNumbers.length);
        pagesDone += 1;
        console.log(`  ✓ is_scraped = TRUE (${stats.done}/${contractNumbers.length})`);
      } else {
        console.log(
          `  leave open: done=${stats.done}/${contractNumbers.length} pending=${stats.pending} — continue next page`
        );
      }
    }
  } finally {
    client.release();
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
