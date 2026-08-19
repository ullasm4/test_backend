/**
 * GeM contract scraper — part-wise processing for contract_lists with is_scrapped = FALSE
 *
 * Usage:
 *   node src/gem/contracts_scrapper.js
 *   node src/gem/contracts_scrapper.js --name "Autonomous Body"
 *   node src/gem/contracts_scrapper.js --parts=10 --part=1
 *   node src/gem/contracts_scrapper.js --parts=10 --part=2 --delay-2
 *   node src/gem/contracts_scrapper.js --limit 5
 *   node src/gem/contracts_scrapper.js --skip-pdf
 *   node src/gem/contracts_scrapper.js --reverse
 *   node src/gem/contracts_scrapper.js --resync
 *
 * Workflow:
 * 1. Load rows from `contract_lists` WHERE is_scrapped = FALSE (ORDER BY from_date DESC)
 * 2. If --part=K --parts=N specified, partition total jobs and run slice for part K
 * 3. For each job window, fetch page listing HTML from GeM
 * 4. Parse contract blocks → insert/update `new_contracts` (seller/buyer from PDF required)
 * 5. POST sbtCaptcha → order_id → download PDF → AWS S3 → pdf-parse →
 *    new_seller_details / new_buyer_details / new_contracts (does not write old contracts/sellers/buyers)
 * 6. Upon completing all pages of a list window → UPDATE contract_lists SET is_scrapped = TRUE
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
// Constants & Configuration
// ---------------------------------------------------------------------------

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const SBT_CAPTCHA = 'https://gem.gov.in/view_contracts/sbtCaptcha';
const PDF_BASE = 'https://fulfilment.gem.gov.in/contract/fds';

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const REQUEST_TIMEOUT_MS = 120000;
const TIMEOUT_COOLDOWN_MS = 60000;
const LONG_COOLDOWN_MS = 180000;
const COOKIE_REFRESH_EVERY = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
GeM Contract Scraper (Part-Wise Scrapper for contract_lists)

Usage:
  node src/gem/contracts_scrapper.js [options]

Options:
  --parts N           Total number of parts to divide unscrapped jobs into
  --part K            Part number to run (1 to N)
  --part K/N          Shorthand for --part=K --parts=N (e.g. --part 1/10)
  --name "NAME"       Filter jobs for a specific ministry/organization name
  --limit N           Maximum number of contracts to process before stopping
  --delay N           Delay in seconds between HTTP requests (e.g. --delay 2)
  --skip-pdf          Skip PDF download/parse (cannot insert into new tables without seller/buyer)
  --reverse           Process jobs oldest-first instead of newest-first
  --resync            Include already scrapped rows (is_scrapped = TRUE)
  --help              Display this help message
`);
}

function parseArgs(argv) {
  const out = {
    delaySec: 0,
    reverse: false,
    part: 0,
    parts: 0,
    limit: 0,
    skipPdf: false,
    resync: false,
    name: '',
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);

    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--reverse') out.reverse = true;
    else if (a === '--skip-pdf') out.skipPdf = true;
    else if (a === '--resync') out.resync = true;
    else if (delayMatch) out.delaySec = Number(delayMatch[1]);
    else if (partSlash) {
      out.part = Number(partSlash[1]);
      out.parts = Number(partSlash[2]);
    } else if (
      a === '--delay' ||
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
      else if (key === 'name') out.name = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
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

/** Divide array into `parts` slices; return 1-based `part` slice */
function slicePart(list, part, parts) {
  if (!part && !parts) return list;
  if (!parts || parts < 1) throw new Error('Use --parts=N with --part=K (e.g. --parts=10 --part=1)');
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
// Date Helpers
// ---------------------------------------------------------------------------

function padDate(shortOrPadded) {
  const [dd, mm, yyyy] = String(shortOrPadded).trim().split('-').map(Number);
  return `${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${yyyy}`;
}

function toGemDate(val) {
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${d}-${m}-${y}`;
  }
  const s = String(val).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}-${m}-${y}`;
  }
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(String(val).trim())) {
    return padDate(String(val).trim());
  }
  throw new Error(`Bad date value: ${val}`);
}

function formatShort(dateStr) {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function jobWindowLabel(job) {
  return `${formatShort(toGemDate(job.from_date))} to ${formatShort(toGemDate(job.to_date))}`;
}

// ---------------------------------------------------------------------------
// DB Helpers
// ---------------------------------------------------------------------------

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function loadUnscrappedContractListJobs(pool, { name = '', resync = false } = {}) {
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
// AWS S3 Helper
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
// HTTP Helpers
// ---------------------------------------------------------------------------

async function getCookie() {
  const res = await axios.get(LANDING, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: REQUEST_TIMEOUT_MS,
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

async function fetchPageOnce({ ministry, fromDate, toDate, page, cookie, delayMs }) {
  const body = new URLSearchParams({
    buyer_entity: '',
    buyer_ministry: ministry,
    buyer_state: '',
    fromDate,
    toDate,
    department: '',
    organization: '',
    page: String(page),
  });

  const { data, status } = await axios.post(URL, body.toString(), {
    headers: gemHeaders(cookie),
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (delayMs > 0) await sleep(delayMs);
  return { data, status };
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
    /socket hang up/i.test(msg) ||
    /ECONNRESET/i.test(msg)
  );
}

async function fetchPage({ ministry, fromDate, toDate, page, cookieRef, delayMs }) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchPageOnce({
        ministry,
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
      console.log(
        `    page ${page}: timeout/network error — wait ${Math.round(waitMs / 1000)}s then retry (try ${attempt})`
      );
      await sleep(waitMs);
      if (longPause) {
        try {
          cookieRef.cookie = await getCookie();
          console.log('    session cookie refreshed after cooldown');
        } catch (cookieErr) {
          console.log(`    session cookie refresh error: ${cookieErr.message}`);
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
      /* keep raw */
    }
  }

  const fromQuery = orderId.match(/[?&]?orderId=([^&\s"'<>]+)/i);
  if (fromQuery) orderId = fromQuery[1];
  orderId = orderId.replace(/^orderId=/i, '');
  orderId = orderId.replace(/^["']|["']$/g, '').replace(/\s+/g, '').trim();

  const token = orderId.match(/[A-Za-z0-9+/=]{16,}/);
  if (token) orderId = token[0];
  return orderId;
}

async function fetchOrderId(contractNumber, cookie, delayMs) {
  const body = new URLSearchParams({ oid: contractNumber });
  const { data, status } = await axios.post(SBT_CAPTCHA, body.toString(), {
    headers: gemHeaders(cookie),
    timeout: REQUEST_TIMEOUT_MS,
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
    timeout: REQUEST_TIMEOUT_MS,
    responseType: 'arraybuffer',
    validateStatus: () => true,
  });
  if (delayMs > 0) await sleep(delayMs);
  if (status >= 400) throw new Error(`PDF download HTTP ${status}`);

  const buf = Buffer.from(data);
  const ctype = String(headers['content-type'] || '');
  if (buf.length < 100 || (ctype.includes('html') && buf.slice(0, 20).toString().includes('<'))) {
    throw new Error('PDF download did not return a valid PDF file');
  }
  return buf;
}

// ---------------------------------------------------------------------------
// HTML Parsing
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
// PDF Parsing
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
    console.log(`      order_id obtained`);
  } else {
    console.log(`      order_id already exists`);
  }

  let pdfUrl = row.contract_pdf_url;
  let pdfBuf = null;
  if (!pdfUrl) {
    pdfBuf = await downloadPdf(orderId, delayMs);
    pdfUrl = await uploadPdfToS3(s3, pdfBuf, contractNumber);
    await updateNewContractOrderAndPdf(client, row.id, orderId, pdfUrl);
    console.log(`      pdf uploaded to S3`);
  } else {
    console.log(`      pdf url exists — downloading to parse`);
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

// ---------------------------------------------------------------------------
// Processing Pipeline
// ---------------------------------------------------------------------------

async function processScraperJobs({
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

        // Always skip scrapped windows unless --resync is specified
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
            cookieRef,
            delayMs,
          });

          if (status >= 400 || !data || !String(data).trim()) {
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

        // Mark list window scrapped only when fully completed (not stopped by --limit)
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
          console.log(`  ✓ is_scrapped = TRUE (${label})`);
        } else if (hitLimit) {
          console.log(`  pause: --limit reached, leaving is_scrapped = FALSE`);
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
// Main Driver
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    printHelp();
    return;
  }

  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const wanted = cli.name.trim();

  const pool = createPool();
  let jobs;
  try {
    jobs = await loadUnscrappedContractListJobs(pool, {
      name: wanted,
      resync: cli.resync,
    });
  } finally {
    await pool.end();
  }

  if (!jobs.length) {
    console.log(
      wanted
        ? `No contract_lists rows found for "${wanted}"${cli.resync ? '' : ' with is_scrapped = FALSE'}`
        : `No contract_lists rows found${cli.resync ? '' : ' with is_scrapped = FALSE'}`
    );
    return;
  }

  // Default order: newest date windows first. --reverse flips to oldest first.
  if (cli.reverse) jobs = [...jobs].reverse();

  // Part slicing
  if (cli.part || cli.parts) {
    const before = jobs.length;
    jobs = slicePart(jobs, cli.part, cli.parts);
    console.log(`Part: ${cli.part}/${cli.parts} (${jobs.length} of ${before} jobs selected)`);
  }

  console.log(`Mode: Contract List Scraper`);
  console.log(`Unscrapped Jobs: ${jobs.length}${cli.resync ? ' (resync)' : ' (is_scrapped = FALSE)'}`);
  console.log(`Order: ${cli.reverse ? 'oldest → newest' : 'newest → oldest'}`);
  console.log(`Limit: ${cli.limit || 'none'}`);
  console.log(`Skip PDF: ${cli.skipPdf}`);
  console.log(`Delay: ${delayMs > 0 ? `${cli.delaySec}s` : 'off'}`);
  console.log(`S3 Bucket: ${process.env.S3_BUCKET_NAME || '(missing)'}`);

  if (jobs.length) {
    console.log(`First job: ${jobs[0].name} | ${jobWindowLabel(jobs[0])}`);
    console.log(`Last job:  ${jobs[jobs.length - 1].name} | ${jobWindowLabel(jobs[jobs.length - 1])}\n`);
  }

  const cookieRef = { cookie: await getCookie() };
  const stats = await processScraperJobs({
    jobs,
    cookieRef,
    delayMs,
    limit: cli.limit,
    skipPdf: cli.skipPdf,
    resync: cli.resync,
  });

  console.log(
    `\nAll done! Processed=${stats.processed} Saved=${stats.saved} Skipped=${stats.skipped} SkippedLists=${stats.skippedLists} Errors=${stats.errors} ListsScrapped=${stats.listsDone}`
  );
}

main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
