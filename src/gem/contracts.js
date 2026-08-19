/**
 * GeM contracts ingest — driven by contract_lists (newest years first)
 *
 *   node src/gem/contracts.js
 *   node src/gem/contracts.js --name "Autonomous Body"
 *   node src/gem/contracts.js --limit 3 --delay-3
 *   node src/gem/contracts.js --parts=10 --part=1
 *   node src/gem/contracts.js --scan          # discovery mode → fill results CSV
 *   node src/gem/contracts.js --skip-pdf      # listing only (cannot insert: seller/buyer come from PDF)
 *   node src/gem/contracts.js --resync        # include already is_scrapped rows
 *
 * Import flow (default):
 * 1. Load unscanned rows from contract_lists ORDER BY from_date DESC (2026 → 2025…)
 * 2. Fetch listing HTML → parse each .border.block → store parsed fields
 * 3. Skip if contract_number already complete in new_contracts
 * 4. POST sbtCaptcha → order_id → PDF → S3 → OCR → new_seller_details / new_buyer_details / new_contracts
 * 5. When job window finished → set contract_lists.is_scrapped = true
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
// Keep DATE as YYYY-MM-DD string (avoid IST timezone day-shift)
types.setTypeParser(types.builtins.DATE, (val) => val);
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { PDFParse } = require('pdf-parse');
const { parsePdfSections } = require('./pdf_parse_sections');
const {
  findNewContractByNumber,
  isNewContractComplete,
  updateNewContractOrderAndPdf,
  saveScrapedContract,
} = require('../lib/syncNewTables');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const START_DAY = '01-01-2016';
const END_DAY = '31-12-2026';
const BUYER_MINISTRY = '';
const PAGE = '0';
const BUYER_ENTITY = '';
const BUYER_STATE = '';
const DEPARTMENT = '';
const ORGANIZATION = '';
const COOKIE = '';
const MAX_PAGES = 500;

const NAMES_CSV = path.join(__dirname, 'Untitled spreadsheet - Names.csv');
const RESULTS_CSV = path.join(__dirname, 'contracts-results.csv');

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const SBT_CAPTCHA = 'https://gem.gov.in/view_contracts/sbtCaptcha';
const PDF_BASE = 'https://fulfilment.gem.gov.in/contract/fds';

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    delaySec: 0,
    reverse: false,
    part: 0,
    parts: 0,
    limit: 0,
    scan: false,
    skipPdf: false,
    resync: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);
    if (a === '--reverse') out.reverse = true;
    else if (a === '--scan') out.scan = true;
    else if (a === '--skip-pdf') out.skipPdf = true;
    else if (a === '--resync') out.resync = true;
    else if (delayMatch) out.delaySec = Number(delayMatch[1]);
    else if (partSlash) {
      out.part = Number(partSlash[1]);
      out.parts = Number(partSlash[2]);
    } else if (
      a === '--delay' ||
      a === '--from' ||
      a === '--to' ||
      a === '--page' ||
      a === '--name' ||
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
      else out[key] = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--page=')) out.page = a.slice(7);
    else if (a.startsWith('--name=')) out.name = a.slice(7);
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
  if (!part || part < 1 || part > parts) {
    throw new Error(`--part must be between 1 and ${parts}`);
  }
  const n = list.length;
  const base = Math.floor(n / parts);
  const rem = n % parts;
  let start = 0;
  for (let p = 1; p < part; p++) start += base + (p <= rem ? 1 : 0);
  const size = base + (part <= rem ? 1 : 0);
  return list.slice(start, start + size);
}

// ---------------------------------------------------------------------------
// Dates / CSV
// ---------------------------------------------------------------------------

function parseDDMMYYYY(d) {
  const [dd, mm, yyyy] = String(d).trim().split('-').map(Number);
  if (!dd || !mm || !yyyy) throw new Error(`Invalid date: ${d} (use DD-MM-YYYY)`);
  return new Date(yyyy, mm - 1, dd);
}

function formatDDMMYYYY(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
}

function formatShort(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('-').map(Number);
  return `${dd}-${mm}-${yyyy}`;
}

function padDate(shortOrPadded) {
  const [dd, mm, yyyy] = String(shortOrPadded).trim().split('-').map(Number);
  return `${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${yyyy}`;
}

function addDays(dateStr, days) {
  const d = parseDDMMYYYY(dateStr);
  d.setDate(d.getDate() + days);
  return formatDDMMYYYY(d);
}

function isAfter(a, b) {
  return parseDDMMYYYY(a).getTime() > parseDDMMYYYY(b).getTime();
}

function parseDateRange(label) {
  const m = String(label)
    .trim()
    .match(/^(\d{1,2}-\d{1,2}-\d{4})\s+to\s+(\d{1,2}-\d{1,2}-\d{4})$/i);
  if (!m) throw new Error(`Bad date range in results CSV: ${label}`);
  return { fromDate: padDate(m[1]), toDate: padDate(m[2]) };
}

/** Postgres DATE / ISO → GeM API DD-MM-YYYY */
function toGemDate(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${d}-${m}-${y}`;
  }
  const s = String(val).slice(0, 10);
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  }
  // already DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(String(val).trim())) {
    return padDate(String(val).trim());
  }
  throw new Error(`Bad date value: ${val}`);
}

function jobWindowLabel(job) {
  return `${formatShort(toGemDate(job.from_date))} to ${formatShort(toGemDate(job.to_date))}`;
}

async function loadContractListJobs(pool, { name = '', resync = false } = {}) {
  const params = [];
  const where = [];
  if (!resync) where.push('is_scrapped = FALSE');
  if (name) {
    params.push(name);
    where.push(`lower(name) = lower($${params.length})`);
  }
  where.push('is_scrapped = FALSE');
  const sql = `
    SELECT id, name, from_date, to_date, pages, total_contracts, is_scrapped
    FROM contract_lists
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY from_date DESC, to_date DESC, name ASC
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function markContractListScrapped(client, listId, { pages, totalContracts } = {}) {
  await client.query(
    `UPDATE contract_lists SET
       is_scrapped = TRUE,
       pages = COALESCE($2, pages),
       total_contracts = COALESCE($3, total_contracts),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [listId, pages ?? null, totalContracts ?? null]
  );
}

function hasData(data) {
  if (data == null) return false;
  return String(data).trim().length > 0;
}

function countContracts(data) {
  const s = String(data);
  const byNo = s.match(/GEMC-\d+/g) || [];
  return new Set(byNo).size || (s.match(/ajxtag_order_number/g) || []).length;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function escapeCsvField(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(filePath, header, rows) {
  const lines = [
    header.map(escapeCsvField).join(','),
    ...rows.map((r) => r.map(escapeCsvField).join(',')),
  ];
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function loadMinistryNames(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`Empty CSV: ${filePath}`);
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => /^name$/i.test(h));
  if (nameIdx < 0) throw new Error('Names CSV must have a Name column');
  return rows
    .slice(1)
    .map((cols) => (cols[nameIdx] || '').trim())
    .filter(Boolean);
}

function loadResults(filePath) {
  const header = ['Name', 'date', 'pages'];
  if (!fs.existsSync(filePath)) return { header, rows: [] };
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseCsv(text);
  if (!parsed.length) return { header, rows: [] };
  const h = parsed[0].map((x) => x.trim());
  const nameIdx = h.findIndex((x) => /^name$/i.test(x));
  const dateIdx = h.findIndex((x) => /^date$/i.test(x));
  const pagesIdx = h.findIndex((x) => /^pages?$/i.test(x));
  const rows = parsed
    .slice(1)
    .map((cols) => ({
      name: (cols[nameIdx] || '').trim(),
      date: dateIdx >= 0 ? (cols[dateIdx] || '').trim() : '',
      pages: pagesIdx >= 0 ? (cols[pagesIdx] || '').trim() : '',
    }))
    .filter((r) => r.name && r.date);
  return { header, rows };
}

function saveResult(filePath, { name, date, pages }) {
  const { header, rows } = loadResults(filePath);
  const exists = rows.some(
    (r) => r.name.toLowerCase() === name.toLowerCase() && r.date === date
  );
  if (exists) return false;
  rows.push({ name, date, pages: String(pages) });
  writeCsv(
    filePath,
    header,
    rows.map((r) => [r.name, r.date, r.pages])
  );
  return true;
}

function hasDuplicateDate(filePath, { name, date }) {
  const { rows } = loadResults(filePath);
  return rows.some(
    (r) => r.name.toLowerCase() === name.toLowerCase() && r.date === date
  );
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function getCookie() {
  if (COOKIE && COOKIE.trim()) return COOKIE.trim();
  const res = await axios.get(LANDING, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: 60000,
    validateStatus: () => true,
  });
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
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

async function fetchPage({ ministry, fromDate, toDate, page, cookie, delayMs }) {
  const body = new URLSearchParams({
    buyer_entity: BUYER_ENTITY,
    buyer_ministry: ministry,
    buyer_state: BUYER_STATE,
    fromDate,
    toDate,
    department: DEPARTMENT,
    organization: ORGANIZATION,
    page: String(page),
  });
  const { data, status } = await axios.post(URL, body.toString(), {
    headers: gemHeaders(cookie),
    timeout: 60000,
    validateStatus: () => true,
  });
  if (delayMs > 0) await sleep(delayMs);
  return { data, status };
}

/** Keep only the encoded token — never "orderId=..." or a full URL. */
function normalizeOrderId(raw) {
  let orderId = String(raw ?? '').trim();
  if (!orderId) return '';

  if (orderId.startsWith('{') || orderId.startsWith('[')) {
    try {
      const j = JSON.parse(orderId);
      orderId = String(j.orderId || j.order_id || j.data || j.oid || orderId);
    } catch {
      /* keep raw */
    }
  }

  // strip query/url wrappers: orderId=TOKEN / ?orderId=TOKEN / full URL
  const fromQuery = orderId.match(/[?&]?orderId=([^&\s"'<>]+)/i);
  if (fromQuery) orderId = fromQuery[1];
  orderId = orderId.replace(/^orderId=/i, '');

  orderId = orderId.replace(/^["']|["']$/g, '').replace(/\s+/g, '').trim();

  // encoded token only (base64-ish)
  const token = orderId.match(/[A-Za-z0-9+/=]{16,}/);
  if (token) orderId = token[0];

  return orderId;
}

async function fetchOrderId(contractNumber, cookie, delayMs) {
  const body = new URLSearchParams({ oid: contractNumber });
  const { data, status } = await axios.post(SBT_CAPTCHA, body.toString(), {
    headers: gemHeaders(cookie),
    timeout: 60000,
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  if (delayMs > 0) await sleep(delayMs);
  if (status >= 400) throw new Error(`sbtCaptcha HTTP ${status}`);

  const orderId = normalizeOrderId(data);
  if (!orderId) throw new Error(`empty order_id for ${contractNumber}`);
  return orderId;
}

async function downloadPdf(orderId, delayMs) {
  const url = `${PDF_BASE}?orderId=${encodeURIComponent(orderId)}`;
  const { data, status, headers } = await axios.get(url, {
    headers: {
      Accept: 'application/pdf,*/*',
      'User-Agent': UA,
      Referer: LANDING,
    },
    timeout: 120000,
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  if (delayMs > 0) await sleep(delayMs);
  if (status >= 400) throw new Error(`PDF download HTTP ${status}`);
  const buf = Buffer.from(data);
  const ctype = String(headers['content-type'] || '');
  if (buf.length < 100 || (ctype.includes('html') && buf.slice(0, 20).toString().includes('<'))) {
    throw new Error('PDF download did not return a PDF');
  }
  return buf;
}

// ---------------------------------------------------------------------------
// HTML parse
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// PDF text parse
// ---------------------------------------------------------------------------

async function extractPdfText(buf) {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result.text || '');
  } finally {
    if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function getMinistryId(client, name) {
  const existing = await client.query(
    'SELECT id FROM contract_ministry WHERE lower(name) = lower($1) LIMIT 1',
    [name]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO contract_ministry (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name]
  );
  return inserted.rows[0].id;
}

// ---------------------------------------------------------------------------
// Import one contract (new tables only)
// ---------------------------------------------------------------------------

async function enrichContract({
  client,
  s3,
  contractRow,
  contractNumber,
  cookie,
  delayMs,
  skipPdf,
  ministryId,
  block,
}) {
  if (skipPdf) return { skipped: true };

  const row = contractRow || {};
  let orderId = normalizeOrderId(row.order_id);
  if (row.id && row.order_id && orderId && row.order_id !== orderId) {
    await updateNewContractOrderAndPdf(client, row.id, orderId, null);
  }
  if (!orderId) {
    orderId = await fetchOrderId(contractNumber, cookie, delayMs);
    await updateNewContractOrderAndPdf(client, row.id, orderId, null);
    console.log(`      order_id ok`);
  } else {
    console.log(`      order_id exists`);
  }

  let pdfUrl = row.contract_pdf_url;
  let pdfBuf = null;
  if (!pdfUrl) {
    pdfBuf = await downloadPdf(orderId, delayMs);
    pdfUrl = await uploadPdfToS3(s3, pdfBuf, contractNumber);
    await updateNewContractOrderAndPdf(client, row.id, orderId, pdfUrl);
    console.log(`      pdf uploaded`);
  } else {
    console.log(`      pdf url exists — re-extract text`);
    pdfBuf = await downloadPdf(orderId, delayMs);
  }

  const text = await extractPdfText(pdfBuf);
  const parsed = parsePdfSections(text);

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
    existingId: row.id || null,
    ministryId,
    block,
    parsed,
    seller,
    buyer,
    orderId,
    pdfUrl,
  });
  console.log(
    `      saved to new tables → seller="${seller.company_name || seller.seller_id}" buyer="${buyer.company_name || buyer.email}"`
  );
  return { orderId, pdfUrl };
}

async function processResultsJobs({
  jobs,
  cookieRef,
  delayMs,
  limit,
  skipPdf,
  resync = false,
}) {
  const pool = createPool();
  const s3 = createS3();
  let processed = 0;
  let saved = 0;
  let skipped = 0;
  let skippedLists = 0;
  let errors = 0;
  let listsDone = 0;

  try {
    const client = await pool.connect();
    try {
      for (const job of jobs) {
        if (limit > 0 && processed >= limit) break;

        const label = jobWindowLabel(job);

        // Always skip already-scrapped windows unless --resync
        if (job.is_scrapped && !resync) {
          skippedLists += 1;
          console.log(`\n======== skip scrapped: ${job.name} | ${label} ========`);
          continue;
        }

        const fromDate = toGemDate(job.from_date);
        const toDate = toGemDate(job.to_date);
        const pages = Math.max(1, Number(job.pages) || 1);
        console.log(
          `\n======== ${job.name} | ${label} | pages=${pages} ========`
        );

        cookieRef.cookie = await getCookie();
        const ministryId = await getMinistryId(client, job.name);

        let jobContracts = 0;
        let hitLimit = false;

        for (let page = 0; page < pages; page++) {
          if (limit > 0 && processed >= limit) {
            hitLimit = true;
            break;
          }

          const { data, status } = await fetchPage({
            ministry: job.name,
            fromDate,
            toDate,
            page,
            cookie: cookieRef.cookie,
            delayMs,
          });

          if (status >= 400 || !hasData(data)) {
            console.log(`  page ${page}: empty/status=${status}`);
            continue;
          }

          const blocks = parseContractBlocks(data);
          console.log(`  page ${page}: contracts=${blocks.length}`);

          for (const block of blocks) {
            if (limit > 0 && processed >= limit) {
              hitLimit = true;
              break;
            }

            const existing = await findNewContractByNumber(client, block.contract_number);
            if (existing && isNewContractComplete(existing)) {
              skipped += 1;
              console.log(`    skip duplicate: ${block.contract_number}`);
              continue;
            }

            if (skipPdf) {
              skipped += 1;
              console.log(`    skip --skip-pdf (new tables require seller/buyer from PDF)`);
              continue;
            }

            processed += 1;
            jobContracts += 1;
            console.log(`    [${processed}] ${block.contract_number}`);

            try {
              if (existing) console.log(`      resume enrich (incomplete)`);
              await enrichContract({
                client,
                s3,
                contractRow: existing,
                contractNumber: block.contract_number,
                cookie: cookieRef.cookie,
                delayMs,
                skipPdf,
                ministryId,
                block,
              });
              saved += 1;
            } catch (err) {
              errors += 1;
              console.log(`      save failed: ${err.message}`);
            }
          }
          if (hitLimit) break;
        }

        // Mark list window scraped only when fully finished (not cut by --limit)
        if (!hitLimit && job.id) {
          const totalContracts =
            Number(job.total_contracts) > 0
              ? Number(job.total_contracts)
              : jobContracts;
          await markContractListScrapped(client, job.id, {
            pages,
            totalContracts,
          });
          listsDone += 1;
          console.log(`  ✓ is_scrapped=true  (${label})`);
        } else if (hitLimit) {
          console.log(`  pause: --limit reached, leave is_scrapped=false`);
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  return { processed, saved, skipped, skippedLists, errors, listsDone };
}

// ---------------------------------------------------------------------------
// Scan mode (discovery → results CSV)
// ---------------------------------------------------------------------------

async function countPagesForMinistry({ ministry, fromDate, toDate, startPage, cookie, delayMs }) {
  let page = startPage;
  let totalPages = 0;
  let totalContracts = 0;
  while (true) {
    const { data } = await fetchPage({
      ministry,
      fromDate,
      toDate,
      page,
      cookie,
      delayMs,
    });
    if (!hasData(data)) break;
    const count = countContracts(data);
    totalPages += 1;
    totalContracts += count;
    console.log(`    page ${page}: yes  contracts=${count}`);
    page += 1;
    if (totalPages >= MAX_PAGES) {
      console.log(`    stopped at MAX_PAGES=${MAX_PAGES}`);
      break;
    }
  }
  return { totalPages, totalContracts };
}

async function scanMinistry({ ministry, startDay, endDay, startPage, cookie, delayMs }) {
  let day = startDay;
  let savedCount = 0;
  let skippedEmpty = 0;
  let skippedDup = 0;

  while (!isAfter(day, endDay)) {
    const fromDate = day;
    const toDate = addDays(day, 90);
    const dateLabel = `${formatShort(fromDate)} to ${formatShort(toDate)}`;
    const nextDate = addDays(toDate, 1);
    console.log(`  range: ${dateLabel}`);

    if (hasDuplicateDate(RESULTS_CSV, { name: ministry, date: dateLabel })) {
      console.log('  skip: duplicate date');
      skippedDup += 1;
      day = nextDate;
      continue;
    }

    const { totalPages, totalContracts } = await countPagesForMinistry({
      ministry,
      fromDate,
      toDate,
      startPage,
      cookie,
      delayMs,
    });

    if (totalPages === 0) {
      console.log('  no data → nextdate', formatShort(nextDate));
      skippedEmpty += 1;
      day = nextDate;
      continue;
    }

    const saved = saveResult(RESULTS_CSV, {
      name: ministry,
      date: dateLabel,
      pages: totalPages,
    });
    if (saved) {
      savedCount += 1;
      console.log(`  yes  pages=${totalPages}  contracts=${totalContracts}  saved`);
    } else {
      skippedDup += 1;
      console.log('  skip: duplicate date');
    }
    console.log('  nextdate:', formatShort(nextDate));
    day = nextDate;
  }
  return { savedCount, skippedEmpty, skippedDup };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const wanted = (cli.name !== undefined ? cli.name : BUYER_MINISTRY).trim();

  if (cli.scan) {
    const startDay = cli.from || START_DAY;
    const endDay = cli.to || END_DAY;
    let startPage = Number(cli.page !== undefined ? cli.page : PAGE);
    if (Number.isNaN(startPage) || startPage < 0) startPage = 0;

    const allNames = loadMinistryNames(NAMES_CSV);
    let ministries = allNames;
    if (wanted) {
      const one = allNames.find((n) => n.toLowerCase() === wanted.toLowerCase());
      if (!one) throw new Error(`Ministry "${wanted}" not found in Names CSV`);
      ministries = [one];
    } else {
      if (cli.reverse) ministries = [...allNames].reverse();
      if (cli.part || cli.parts) {
        ministries = slicePart(ministries, cli.part, cli.parts);
      }
    }

    console.log(`mode: scan`);
    console.log(`ministries: ${ministries.length}`);
    console.log(`date scan: ${formatShort(startDay)} → ${formatShort(endDay)}`);
    console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s` : 'off'}\n`);

    let cookie = await getCookie();
    for (let i = 0; i < ministries.length; i++) {
      const ministry = ministries[i];
      console.log(`\n======== [${i + 1}/${ministries.length}] ${ministry} ========`);
      cookie = await getCookie();
      const stats = await scanMinistry({
        ministry,
        startDay,
        endDay,
        startPage,
        cookie,
        delayMs,
      });
      console.log(
        `done: ${ministry}  saved=${stats.savedCount}  empty=${stats.skippedEmpty}  dup=${stats.skippedDup}`
      );
    }
    console.log('\nall done');
    return;
  }

  // ---- import from contract_lists (newest years first) ----
  const pool = createPool();
  let jobs;
  try {
    jobs = await loadContractListJobs(pool, {
      name: wanted,
      resync: cli.resync,
    });
  } finally {
    await pool.end();
  }

  if (!jobs.length) {
    throw new Error(
      wanted
        ? `No contract_lists rows for "${wanted}"${cli.resync ? '' : ' with is_scrapped=false'}`
        : `No contract_lists rows${cli.resync ? '' : ' with is_scrapped=false'}`
    );
  }

  // Default order is from_date DESC (2026 → 2025…). --reverse flips to oldest first.
  if (cli.reverse) jobs = [...jobs].reverse();
  if (cli.part || cli.parts) {
    const before = jobs.length;
    jobs = slicePart(jobs, cli.part, cli.parts);
    console.log(`part: ${cli.part}/${cli.parts}  (${jobs.length} of ${before} jobs)`);
  }

  console.log(`mode: import`);
  console.log(`jobs: ${jobs.length}${cli.resync ? ' (resync)' : ' (is_scrapped=false)'}`);
  console.log(`order: ${cli.reverse ? 'oldest → newest' : 'newest → oldest (2026 first)'}`);
  console.log(`limit: ${cli.limit || 'none'}`);
  console.log(`skip-pdf: ${cli.skipPdf}`);
  console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s` : 'off'}`);
  console.log(`s3 bucket: ${process.env.S3_BUCKET_NAME || '(missing)'}`);
  if (jobs.length) {
    console.log(`first job: ${jobs[0].name} | ${jobWindowLabel(jobs[0])}`);
    console.log(`last job:  ${jobs[jobs.length - 1].name} | ${jobWindowLabel(jobs[jobs.length - 1])}\n`);
  }

  const cookieRef = { cookie: await getCookie() };
  const stats = await processResultsJobs({
    jobs,
    cookieRef,
    delayMs,
    limit: cli.limit,
    skipPdf: cli.skipPdf,
    resync: cli.resync,
  });

  console.log(
    `\nall done  processed=${stats.processed}  saved=${stats.saved}  skipped=${stats.skipped}  skipped_lists=${stats.skippedLists}  errors=${stats.errors}  lists_scrapped=${stats.listsDone}`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
