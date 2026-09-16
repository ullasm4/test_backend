/**
 * Fill missing GEMC numbers between consecutive rows in new_contracts.
 *
 *   1. SELECT contract_number FROM new_contracts
 *      WHERE contract_date > :fromDate (or --contract-date month/day) ORDER BY contract_number
 *   2. First/last anchors printed; walk gaps A+1 … B-1 between consecutive pairs
 *      If number already in new_contracts OR not_found_contracts → skip (no GeM curl).
 *      Close + restart resumes from remaining_scrape_cursor (does not start at gap 1).
 *   3. Else: claim not_found row → POST sbtCaptcha(oid) → orderId → PDF → S3 → new_contracts
 *      (GeM miss / killed mid-call stays in not_found_contracts, so restart does not re-curl)
 *
 * Same enrich/save path as new_contract_scrapped.js (order_id → PDF → seller/buyer).
 *
 *   node src/gem/remaning_contracts_scrapper.js
 *   node src/gem/remaning_contracts_scrapper.js --from-date 2026-09-01 --delay-2
 *   node src/gem/remaning_contracts_scrapper.js --contract-date 09-2026 --parts=2 --part=1
 *   node src/gem/remaning_contracts_scrapper.js --concurrency 12 --limit 50
 *   node src/gem/remaning_contracts_scrapper.js --dry-run
 */


require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const { Pool, types } = require('pg');
types.setTypeParser(types.builtins.DATE, (val) => val);

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { PDFParse } = require('pdf-parse');
const { parsePdfSections } = require('./pdf_parse_sections');
const { saveScrapedContract } = require('../lib/syncNewTables');
const { parseGemContractDate } = require('../lib/htmlFields');
const { deriveBuyingMode } = require('../lib/contractLookups');

const LANDING = 'https://gem.gov.in/view_contracts';
const SBT_CAPTCHA = 'https://gem.gov.in/view_contracts/sbtCaptcha';
/** Exact host from GeM sbtCaptcha Download href. */
const PDF_BASE = 'https://fulfilment.gem.gov.in/contract/fds';

const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const REQUEST_TIMEOUT_MS = 60000;
const CAPTCHA_TIMEOUT_MS = 20000;
const TIMEOUT_COOLDOWN_MS = 30000;
const COOKIE_REFRESH_EVERY = 80;
const FATAL_RESTART_MS = 30000;
/** Captcha can return orderId while PDF body is empty — fail-fast (no long retry). */
const PDF_MAX_ATTEMPTS = 3;
const PDF_BACKOFF_MS = [2000, 4000, 8000];
const PDF_MIN_BYTES = 100;
const PDF_GAP_MS = 400;
/** Skip consecutive pairs farther apart than this (different GEMC series). */
const SKIP_PAIR_GAP_OVER = 20000;
const DEFAULT_FROM_DATE = '2026-08-01';
const DEFAULT_CONCURRENCY = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let stopRequested = false;

function installStopHandlers() {
  const onStop = (sig) => {
    if (stopRequested) {
      console.log(`\n${sig} again — forcing exit`);
      process.exit(1);
    }
    stopRequested = true;
    console.log(`\n${sig} received — will stop after current batch`);
  };
  process.on('SIGINT', () => onStop('SIGINT'));
  process.on('SIGTERM', () => onStop('SIGTERM'));
}

function parseArgs(argv) {
  const out = {
    delaySec: 0,
    part: 0,
    parts: 0,
    limit: 0,
    fromDate: '',
    contractDate: '',
    startFrom: '',
    concurrency: DEFAULT_CONCURRENCY,
    reverse: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);

    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--reverse' || a === '--is-reverse') out.reverse = true;
    else if (delayMatch) out.delaySec = Number(delayMatch[1]);
    else if (partSlash) {
      out.part = Number(partSlash[1]);
      out.parts = Number(partSlash[2]);
    } else if (
      a === '--delay' ||
      a === '--part' ||
      a === '--parts' ||
      a === '--limit' ||
      a === '--from-date' ||
      a === '--contract-date' ||
      a === '--contract_date' ||
      a === '--date' ||
      a === '--start-from' ||
      a === '--start' ||
      a === '--concurrency'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else if (key === 'limit') out.limit = Number(val);
      else if (key === 'from-date') out.fromDate = val;
      else if (key === 'contract-date' || key === 'contract_date' || key === 'date') {
        out.contractDate = val;
      } else if (key === 'start-from' || key === 'start') out.startFrom = val;
      else if (key === 'concurrency') out.concurrency = Number(val);
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a.startsWith('--from-date=')) out.fromDate = a.slice(12);
    else if (a.startsWith('--contract-date=')) out.contractDate = a.slice(16);
    else if (a.startsWith('--contract_date=')) out.contractDate = a.slice(16);
    else if (a.startsWith('--date=')) out.contractDate = a.slice(7);
    else if (a.startsWith('--start-from=')) out.startFrom = a.slice(13);
    else if (a.startsWith('--start=')) out.startFrom = a.slice(8);
    else if (a.startsWith('--concurrency=')) out.concurrency = Number(a.slice(14));
  }

  if (Number.isNaN(out.delaySec) || out.delaySec < 0) out.delaySec = 0;
  if (Number.isNaN(out.part) || out.part < 0) out.part = 0;
  if (Number.isNaN(out.parts) || out.parts < 0) out.parts = 0;
  if (Number.isNaN(out.limit) || out.limit < 0) out.limit = 0;
  if (Number.isNaN(out.concurrency) || out.concurrency < 1) out.concurrency = DEFAULT_CONCURRENCY;
  if (out.concurrency > 20) out.concurrency = 20;

  out.fromDate = String(out.fromDate || '').trim();
  out.contractDate = String(out.contractDate || '').trim();
  out.startFrom = String(out.startFrom || '').trim().toUpperCase();

  if (!out.contractDate && !out.fromDate) {
    out.fromDate = DEFAULT_FROM_DATE;
  }
  if (out.fromDate && !/^\d{4}-\d{2}-\d{2}$/.test(out.fromDate)) {
    throw new Error(`Invalid --from-date "${out.fromDate}" (use YYYY-MM-DD)`);
  }

  if (out.part || out.parts) {
    if (!out.parts || out.parts < 1) {
      throw new Error('Use --parts=N with --part=K (e.g. --parts=4 --part=1)');
    }
    if (!out.part || out.part < 1 || out.part > out.parts) {
      throw new Error(`--part must be between 1 and ${out.parts}`);
    }
  }
  return out;
}

/**
 * Parse --contract-date into ISO range { from, to, label }.
 *   MM-YYYY | YYYY-MM | MM/YYYY  → full month
 *   DD-MM-YYYY | YYYY-MM-DD      → single day
 */
function parseContractDateArg(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return { from: iso, to: iso, label: iso };
  }

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const iso = `${m[3]}-${mm}-${dd}`;
    return { from: iso, to: iso, label: iso };
  }

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
    `Invalid --contract-date "${s}" (use MM-YYYY e.g. 01-2026, or YYYY-MM-DD)`
  );
}

/** Resolve CLI into { from, to, label, mode }. */
function resolveDateFilter(cli) {
  if (cli.contractDate) {
    const range = parseContractDateArg(cli.contractDate);
    return { ...range, mode: 'range' };
  }
  // legacy: contract_date > fromDate
  return {
    from: cli.fromDate,
    to: null,
    label: `>${cli.fromDate}`,
    mode: 'after',
  };
}

/** Keep only PDF dates inside the scrape window (avoids Apr-2024 while scraping Aug-2026). */
function isContractDateInFilter(isoDate, dateFilter) {
  if (!isoDate || !dateFilter) return true;
  if (dateFilter.mode === 'range') {
    if (dateFilter.from && isoDate < dateFilter.from) return false;
    if (dateFilter.to && isoDate > dateFilter.to) return false;
    return true;
  }
  // mode=after → contract_date > from
  if (dateFilter.from) return isoDate > dateFilter.from;
  return true;
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 8,
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

function parseGemc(contractNumber) {
  const m = String(contractNumber || '')
    .trim()
    .toUpperCase()
    .match(/^(GEMC-)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], digits: m[2], value: BigInt(m[2]), width: m[2].length };
}

function formatGemc(prefix, value, width) {
  return `${prefix}${String(value).padStart(width, '0')}`;
}

/** Sorted distinct GEMC numbers for the date window (gap anchors). */
async function loadSortedAnchors(pool, dateFilter) {
  const t0 = Date.now();
  let sql;
  let params;
  if (dateFilter.mode === 'range') {
    sql = `SELECT DISTINCT contract_number
           FROM new_contracts
           WHERE contract_date >= $1::date
             AND contract_date <= $2::date
             AND contract_number ~ '^GEMC-[0-9]+$'
           ORDER BY contract_number ASC`;
    params = [dateFilter.from, dateFilter.to];
  } else {
    sql = `SELECT DISTINCT contract_number
           FROM new_contracts
           WHERE contract_date > $1::date
             AND contract_number ~ '^GEMC-[0-9]+$'
           ORDER BY contract_number ASC`;
    params = [dateFilter.from];
  }
  const { rows } = await pool.query(sql, params);
  const list = rows.map((r) => String(r.contract_number).trim().toUpperCase());
  console.log(`  loaded ${list.length} anchors in ${Date.now() - t0}ms`);
  return list;
}

/**
 * Build consecutive gap descriptors only (no expanded missing list).
 * Skips pairs with gap > SKIP_PAIR_GAP_OVER (series jumps).
 */
function buildGapDescriptors(anchors) {
  const gaps = [];
  let skippedHuge = 0;
  let rawMissing = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const a = parseGemc(anchors[i]);
    const b = parseGemc(anchors[i + 1]);
    if (!a || !b || a.prefix !== b.prefix) continue;
    if (b.value <= a.value + 1n) continue;

    const count = Number(b.value - a.value - 1n);
    if (count > SKIP_PAIR_GAP_OVER) {
      skippedHuge += 1;
      continue;
    }

    rawMissing += count;
    gaps.push({
      prefix: a.prefix,
      width: Math.max(a.width, b.width),
      from: a.value + 1n,
      to: b.value - 1n,
      after: anchors[i],
      before: anchors[i + 1],
      count,
    });
  }

  return { gaps, skippedHuge, rawMissing };
}

/**
 * Pull next batch inside one gap by moving cursor (+1 or -1).
 * state: { prefix, width, cursor, endValue, reverse, visited }
 */
function takeNextBatch(state, skipSet, batchSize) {
  const batch = [];
  let skippedKnown = 0;
  const done = () =>
    state.reverse ? state.cursor < state.endValue : state.cursor > state.endValue;

  while (batch.length < batchSize && !done()) {
    const num = formatGemc(state.prefix, state.cursor, state.width);
    if (state.reverse) state.cursor -= 1n;
    else state.cursor += 1n;
    state.visited += 1;
    if (skipSet.has(num)) {
      skippedKnown += 1;
      continue;
    }
    batch.push(num);
  }
  return { batch, skippedKnown };
}

/**
 * Numbers already in new_contracts or not_found_contracts must not be curled again.
 * claimForProbe inserts only the unknown ones; a restart reads those rows and skips them.
 */

/** Load both tables for one gap so a re-run skips them before any GeM call. */
async function loadGapKnown(client, gap, skipSet) {
  const fromNum = formatGemc(gap.prefix, gap.from, gap.width);
  const toNum = formatGemc(gap.prefix, gap.to, gap.width);
  const low = fromNum <= toNum ? fromNum : toNum;
  const high = fromNum <= toNum ? toNum : fromNum;
  const { rows } = await client.query(
    `SELECT contract_number
       FROM new_contracts
      WHERE contract_number >= $1
        AND contract_number <= $2
        AND length(contract_number) = $3
     UNION
     SELECT contract_number
       FROM not_found_contracts
      WHERE contract_number >= $1
        AND contract_number <= $2
        AND length(contract_number) = $3`,
    [low, high, low.length]
  );
  let added = 0;
  for (const r of rows) {
    const n = String(r.contract_number).trim().toUpperCase();
    if (skipSet.has(n)) continue;
    skipSet.add(n);
    added += 1;
  }
  return { found: rows.length, added };
}

/**
 * One row per (date window, part, direction). Restart reads this and does not
 * walk / curl numbers already passed.
 */
async function ensureCursorTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS remaining_scrape_cursor (
      scope text PRIMARY KEY,
      last_contract_number text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function cursorScope(dateFilter, cli, reverse) {
  return `${dateFilter.label}|part=${cli.part || 0}|reverse=${reverse ? 1 : 0}`;
}

async function loadCursor(pool, scope) {
  const { rows } = await pool.query(
    `SELECT last_contract_number
       FROM remaining_scrape_cursor
      WHERE scope = $1`,
    [scope]
  );
  return String(rows[0]?.last_contract_number || '').trim().toUpperCase();
}

async function saveCursor(client, scope, contractNumber) {
  if (!scope || !contractNumber) return;
  try {
    await client.query(
      `INSERT INTO remaining_scrape_cursor (scope, last_contract_number, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (scope) DO UPDATE
         SET last_contract_number = EXCLUDED.last_contract_number,
             updated_at = now()`,
      [scope, contractNumber]
    );
  } catch (err) {
    console.log(`  cursor save failed ${contractNumber}: ${err.message || err}`);
  }
}

/** Insert only numbers that are in neither table. Returned rows are the ones to curl. */
async function claimForProbe(client, numbers) {
  if (!numbers.length) return [];
  const { rows } = await client.query(
    `INSERT INTO not_found_contracts (contract_number)
     SELECT n
       FROM unnest($1::text[]) AS n
      WHERE NOT EXISTS (
              SELECT 1 FROM not_found_contracts nf WHERE nf.contract_number = n
            )
        AND NOT EXISTS (
              SELECT 1 FROM new_contracts c WHERE c.contract_number = n
            )
     ON CONFLICT (contract_number) DO NOTHING
     RETURNING contract_number`,
    [numbers]
  );
  return rows.map((r) => String(r.contract_number).trim().toUpperCase());
}

async function releaseClaim(client, contractNumber) {
  await client.query(
    `DELETE FROM not_found_contracts WHERE contract_number = $1`,
    [contractNumber]
  );
}

/** Drop gaps wholly behind the saved cursor (forward: before it, reverse: after it). */
function trimGapsAlreadyPassed(gaps, resumeNumber, reverse) {
  const parsed = parseGemc(resumeNumber);
  if (!parsed) return gaps;
  return gaps.filter((gap) =>
    reverse ? gap.from <= parsed.value : gap.to >= parsed.value
  );
}

/**
 * First close of the new cursor: jump past the already-stored prefix so a
 * restart does not begin at gap 1 and re-curl those numbers.
 * Returns the last number that is already in new_contracts or not_found_contracts.
 */
async function findResumeFromKnown(pool, gaps, reverse) {
  const skip = new Set();
  let lastDone = '';
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    await loadGapKnown(pool, gap, skip);
    const step = reverse ? -1n : 1n;
    let value = reverse ? gap.to : gap.from;
    const end = reverse ? gap.from : gap.to;
    const done = () => (reverse ? value < end : value > end);
    let blocked = false;
    while (!done()) {
      const num = formatGemc(gap.prefix, value, gap.width);
      if (!skip.has(num)) {
        blocked = true;
        break;
      }
      lastDone = num;
      value += step;
    }
    if (blocked) break;
    if (i === 0 || (i + 1) % 50 === 0) {
      console.log(`  resume scan ${i + 1}/${gaps.length} last stored=${lastDone || '-'}`);
    }
  }
  return lastDone;
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

function isRetryablePdfError(err) {
  if (err?.httpStatus != null && err.httpStatus >= 400) return false;
  if (err?.code === 'INVALID_PDF' || err?.retryable === true) return true;
  return isRetryableError(err);
}

function normalizeOrderId(raw) {
  let orderId = String(raw ?? '').trim();
  if (!orderId) return '';

  if (orderId.startsWith('{') || orderId.startsWith('[')) {
    try {
      const j = JSON.parse(orderId);
      const extracted = j?.orderId || j?.order_id || j?.data || j?.oid || j?.code || '';
      if (extracted) orderId = String(extracted).trim();
      else if (j?.status === '0' || j?.status === 0) return '';
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

/** Captcha probe — returns orderId string (same as new_contract_scrapped). */
async function fetchOrderId(contractNumber, cookie) {
  const { data, status } = await axios.post(
    SBT_CAPTCHA,
    new URLSearchParams({ oid: contractNumber }).toString(),
    {
      headers: gemHeaders(cookie),
      timeout: CAPTCHA_TIMEOUT_MS,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(d) => d],
    }
  );
  if (status >= 400) {
    const e = new Error(`sbtCaptcha HTTP ${status}`);
    e.code = `HTTP_${status}`;
    e.retryable = status >= 500 || status === 429;
    throw e;
  }
  const raw = String(data ?? '').trim();
  const orderId = normalizeOrderId(raw);
  if (!orderId) {
    const e = new Error('NO_ORDER_ID');
    e.code = 'NO_ORDER_ID';
    e.retryable = false;
    throw e;
  }
  return orderId;
}

function assertValidPdfBuffer(buf, headers = {}) {
  const length = buf?.length || 0;
  if (!buf || length < PDF_MIN_BYTES) {
    const e = new Error(`PDF too small (${length} bytes)`);
    e.code = 'EMPTY_PDF';
    e.retryable = false; // GeM has no file for this orderId — retrying wastes time
    e.emptyBody = true;
    throw e;
  }
  const head = buf.slice(0, 8).toString('latin1');
  if (!head.startsWith('%PDF')) {
    const ctype = String(headers['content-type'] || '').toLowerCase();
    const e = new Error(
      ctype.includes('html')
        ? 'PDF endpoint returned HTML instead of PDF'
        : 'PDF missing %PDF magic'
    );
    e.code = 'INVALID_PDF';
    e.retryable = true;
    throw e;
  }
}

/**
 * Same headers as new_contract_scrapped.js — do NOT send gem.gov.in cookies here.
 */
async function downloadPdfOnce(orderId) {
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
    e.retryable = status === 429 || status >= 500;
    throw e;
  }
  const buf = Buffer.from(data || []);
  assertValidPdfBuffer(buf, headers);
  return buf;
}

/**
 * Fresh captcha → PDF.
 * Empty 0-byte GeM body = permanent miss for that contract → fail fast (no 4× retry spam).
 * Network/HTML errors still retry briefly.
 */
async function downloadPdfWithFreshOrder({ contractNumber, cookie, refreshCookie }) {
  let activeCookie = cookie;
  let lastOrderId = '';

  // One captcha + one PDF attempt for empty-file cases
  if (typeof refreshCookie === 'function' && !activeCookie) {
    activeCookie = await refreshCookie(false);
  }
  lastOrderId = await fetchOrderId(contractNumber, activeCookie);
  console.log(`      order_id obtained (${lastOrderId.slice(0, 12)}…)`);
  if (PDF_GAP_MS > 0) await sleep(PDF_GAP_MS);

  try {
    const buf = await downloadPdfOnce(lastOrderId);
    return { buf, orderId: lastOrderId };
  } catch (err) {
    // Permanent: GeM returned HTTP 200 with 0 bytes — do not retry
    if (err?.code === 'EMPTY_PDF' || err?.emptyBody) {
      const e = new Error(`GeM has no PDF file for ${contractNumber}`);
      e.code = 'EMPTY_PDF';
      e.retryable = false;
      e.orderId = lastOrderId;
      throw e;
    }

    // Transient network / bad HTML — short retries with fresh orderId
    if (!isRetryablePdfError(err) && err?.code !== 'INVALID_PDF') throw err;

    let lastErr = err;
    for (let attempt = 2; attempt <= PDF_MAX_ATTEMPTS; attempt++) {
      const waitMs = PDF_BACKOFF_MS[attempt - 2] ?? 4000;
      console.log(
        `      pdf:${lastErr.code || 'ERROR'} — wait ${Math.round(waitMs / 1000)}s (try ${attempt}/${PDF_MAX_ATTEMPTS})`
      );
      await sleep(waitMs);
      try {
        if (typeof refreshCookie === 'function') {
          activeCookie = await refreshCookie(true);
        }
        lastOrderId = await fetchOrderId(contractNumber, activeCookie);
        console.log(`      order_id refreshed (try ${attempt}/${PDF_MAX_ATTEMPTS})`);
        const buf = await downloadPdfOnce(lastOrderId);
        return { buf, orderId: lastOrderId };
      } catch (retryErr) {
        lastErr = retryErr;
        if (retryErr?.code === 'EMPTY_PDF' || retryErr?.emptyBody) {
          const e = new Error(`GeM has no PDF file for ${contractNumber}`);
          e.code = 'EMPTY_PDF';
          e.retryable = false;
          e.orderId = lastOrderId;
          throw e;
        }
        if (!isRetryablePdfError(retryErr) && retryErr?.code !== 'INVALID_PDF') throw retryErr;
      }
    }
    throw lastErr;
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

function extractContractDateFromPdf(text) {
  const m = String(text || '').match(
    /Contract\s*Date\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{1,2}-[A-Za-z]{3}-\d{4})/i
  );
  return m ? m[1] : '';
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

async function resolveStateId(client, { gstNumber, address }) {
  const gst = String(gstNumber || '').trim();
  if (gst.length >= 2 && /^\d{2}/.test(gst)) {
    const code = gst.slice(0, 2);
    const byGst = await client.query(
      `SELECT id FROM states WHERE gst_code = $1 LIMIT 1`,
      [code]
    );
    if (byGst.rows[0]) return byGst.rows[0].id;
  }

  const addr = String(address || '');
  if (!addr) return null;
  const { rows } = await client.query(`SELECT id, name FROM states WHERE name IS NOT NULL`);
  const upper = addr.toUpperCase();
  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (name.length >= 3 && upper.includes(name.toUpperCase())) return row.id;
  }
  return null;
}

async function saveFromPdf({
  client,
  s3,
  contractNumber,
  cookie,
  refreshCookie,
  dateFilter = null,
}) {
  const { buf: pdfBuf, orderId } = await downloadPdfWithFreshOrder({
    contractNumber,
    cookie,
    refreshCookie,
  });
  const text = await extractPdfText(pdfBuf);
  const parsed = parsePdfSections(text);

  const consignee = Array.isArray(parsed.consinee_details)
    ? parsed.consinee_details[0]
    : parsed.consinee_details;
  const contractDateRaw =
    parsed.generated_date ||
    extractContractDateFromPdf(text) ||
    consignee?.delivery_start_after ||
    '';
  const contractDateIso = parseGemContractDate(contractDateRaw);
  // Gap numbers often resolve to other months (GeM IDs are not month-contiguous).
  // Still save with the real PDF date — never put these in not_found (that would
  // block a later scrape for their actual month).
  const offWindow = Boolean(
    dateFilter &&
      contractDateIso &&
      !isContractDateInFilter(contractDateIso, dateFilter)
  );
  if (dateFilter && !contractDateIso) {
    const e = new Error(`no parseable contract date (window ${dateFilter.label})`);
    e.code = 'NO_CONTRACT_DATE';
    e.retryable = false;
    throw e;
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

  const bidNumber = String(parsed.bid_number || '').trim();
  const buyingMode = deriveBuyingMode(bidNumber, parsed.procurement_mode);
  const pdfUrl = await uploadPdfToS3(s3, pdfBuf, contractNumber);

  const ministryId = await resolveMinistryId(
    client,
    parsed.organisation_details?.ministry || ''
  );
  const stateId = await resolveStateId(client, {
    gstNumber: seller.gst_number || buyer.gst_number,
    address:
      buyer.address ||
      parsed.paying_authority?.address ||
      seller.address ||
      '',
  });

  const totalFromPdf = Number(String(parsed.total_order_value || '').replace(/,/g, ''));
  const isService = Boolean(parsed.is_service);

  await saveScrapedContract(client, {
    existingId: null,
    ministryId,
    stateId,
    block: {
      contract_number: contractNumber,
      status_of_the_contract: '',
      org_type: parsed.organisation_details?.type || '',
      org_name: parsed.organisation_details?.organisation_name || '',
      department: parsed.organisation_details?.department || '',
      office_zone: parsed.organisation_details?.office_zone || '',
      buyer_designation: parsed.buyer_details?.designation || '',
      bid_number: bidNumber || '',
      total_value:
        !Number.isNaN(totalFromPdf) && totalFromPdf > 0 ? totalFromPdf : null,
      products_from_html: Array.isArray(parsed.products) ? parsed.products : [],
      buying_mode: buyingMode,
      contract_date: contractDateRaw,
    },
    parsed,
    seller,
    buyer,
    orderId,
    pdfUrl,
    isService,
  });

  return {
    seller,
    buyer,
    pdfUrl,
    contractDate: contractDateRaw,
    contractDateIso: contractDateIso || null,
    totalValue: totalFromPdf || null,
    bidNumber,
    buyingMode,
    offWindow,
  };
}

/** Run async fn over items with limited concurrency. */
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    for (;;) {
      if (stopRequested) return;
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Serialize cookie refresh across concurrent probes. */
function createCookieJar() {
  const jar = { cookie: '', probes: 0, refreshing: null };

  async function ensureCookie(force = false) {
    jar.probes += 1;
    if (!force && jar.cookie && jar.probes % COOKIE_REFRESH_EVERY !== 1) {
      return jar.cookie;
    }
    if (jar.refreshing) {
      await jar.refreshing;
      return jar.cookie;
    }
    jar.refreshing = getCookie()
      .then((c) => {
        jar.cookie = c;
        return c;
      })
      .finally(() => {
        jar.refreshing = null;
      });
    return jar.refreshing;
  }

  return { jar, ensureCookie };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`
Fill gaps between consecutive DB contracts (+1), no full missing list.

  sorted: …001, …002, …999 → walk missing like …003 (NOT global MIN→MAX dump)
  Already in new_contracts or not_found_contracts → skip (no curl on re-run)
  Close + restart resumes from saved cursor (does not start at the first gap)
  GeM miss / killed mid-call → not_found_contracts; hit → PDF → new_contracts

  PARTS=2:
    part 1 → gaps start→end
    part 2 → gaps end→start (--reverse)

  node src/gem/remaning_contracts_scrapper.js
  node src/gem/remaning_contracts_scrapper.js --from-date 2026-09-01 --delay-2
  node src/gem/remaning_contracts_scrapper.js --contract-date 09-2026 --parts=2 --part=1
  node src/gem/remaning_contracts_scrapper.js --concurrency 12 --limit 50
  node src/gem/remaning_contracts_scrapper.js --dry-run

  --from-date      contract_date > DATE (default ${DEFAULT_FROM_DATE})
  --contract-date  DD-MM-YYYY | MM-YYYY | YYYY-MM-DD (month/day window)
  --parts / --part part1 forward, part2 reverse (full gap list)
  --reverse        process gaps from end
  --concurrency N  parallel probes (default ${DEFAULT_CONCURRENCY})
  --delay N        pause after successful save
  --start-from     resume GEMC (overrides saved cursor)
  --limit N        max probes
  --dry-run
`);
    return;
  }

  installStopHandlers();

  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const dateFilter = resolveDateFilter(cli);
  const pool = createPool();

  const bothEnds = cli.parts === 2;
  const reverse = Boolean(
    cli.reverse ||
      (bothEnds && cli.part === 2) ||
      (!bothEnds && cli.parts > 0 && cli.part % 2 === 0)
  );

  console.log(
    `Mode: consecutive gaps ${reverse ? 'end→start' : 'start→end'} (skip huge series jumps > ${SKIP_PAIR_GAP_OVER})`
  );
  if (dateFilter.mode === 'range') {
    console.log(
      dateFilter.from === dateFilter.to
        ? `Contract date: ${dateFilter.from} (${dateFilter.label})`
        : `Contract date: ${dateFilter.from} → ${dateFilter.to} (${dateFilter.label})`
    );
  } else {
    console.log(`From date: contract_date > ${dateFilter.from}`);
  }
  console.log(`Concurrency: ${cli.concurrency}`);
  console.log(`Delay after save: ${delayMs > 0 ? `${cli.delaySec}s` : 'off'}`);
  if (cli.part && cli.parts) {
    console.log(
      `Part: ${cli.part}/${cli.parts}${bothEnds ? (reverse ? ' (end→start)' : ' (start→end)') : ''}`
    );
  }
  if (cli.dryRun) console.log(`Dry run: yes`);

  const scope = cursorScope(dateFilter, cli, reverse);
  await ensureCursorTable(pool);
  const dbCursor = cli.startFrom ? '' : await loadCursor(pool, scope);
  let savedCursor = cli.startFrom || dbCursor;
  // DB cursor is already processed. CLI --start-from is inclusive.
  let cursorAlreadyDone = Boolean(dbCursor) && !cli.startFrom;
  if (cli.startFrom) console.log(`Start from (CLI): ${cli.startFrom}`);
  else if (dbCursor) console.log(`Resume cursor: ${dbCursor} — will not re-curl numbers already passed`);
  else console.log(`Resume cursor: none yet — will skip numbers already in contract/not_found, then save a cursor`);

  const anchors = await loadSortedAnchors(pool, dateFilter);
  if (anchors.length < 2) {
    console.log(`Need ≥2 contract numbers for ${dateFilter.label} (got ${anchors.length})`);
    await pool.end();
    return;
  }

  console.log(`Anchors: ${anchors.length}`);
  console.log(`First: ${anchors[0]}`);
  console.log(`Last:  ${anchors[anchors.length - 1]}`);

  const { gaps, skippedHuge, rawMissing } = buildGapDescriptors(anchors);
  console.log(
    `Gaps: ${gaps.length} | raw missing≈${rawMissing} | huge pairs skipped: ${skippedHuge}`
  );

  if (!gaps.length) {
    console.log('No fillable consecutive gaps.');
    await pool.end();
    return;
  }

  // Order gaps for this part (both parts see all gaps when parts=2)
  let workGaps = gaps;
  if (!bothEnds && cli.part && cli.parts) {
    const n = gaps.length;
    const base = Math.floor(n / cli.parts);
    const rem = n % cli.parts;
    let start = 0;
    for (let p = 1; p < cli.part; p++) start += base + (p <= rem ? 1 : 0);
    const size = base + (cli.part <= rem ? 1 : 0);
    workGaps = gaps.slice(start, start + size);
  }
  if (reverse) workGaps = [...workGaps].reverse();

  if (!cli.dryRun && !savedCursor && workGaps.length) {
    console.log('Finding resume point from numbers already in contract/not_found (no GeM curl)…');
    const seeded = await findResumeFromKnown(pool, workGaps, reverse);
    if (seeded) {
      savedCursor = seeded;
      cursorAlreadyDone = true;
      await saveCursor(pool, scope, seeded);
      console.log(`Resume cursor seeded: ${seeded} — will not re-curl numbers already passed`);
    }
  }

  const gapsBeforeCursor = workGaps.length;
  if (savedCursor) workGaps = trimGapsAlreadyPassed(workGaps, savedCursor, reverse);

  if (!workGaps.length) {
    console.log(
      savedCursor
        ? `Nothing left past resume cursor ${savedCursor}. Close + restart will not re-curl.`
        : 'No fillable consecutive gaps for this part.'
    );
    await pool.end();
    return;
  }

  console.log(
    `This part gaps: ${workGaps.length}${
      savedCursor ? ` (${gapsBeforeCursor - workGaps.length} gaps already passed, skipped)` : ''
    } | next gap after ${workGaps[0].after} → before ${workGaps[0].before}`
  );

  // Anchors are already in new_contracts. Each gap also loads new_contracts +
  // not_found_contracts in that number range so a re-run does not re-curl them.
  const skipSet = new Set(anchors);
  console.log(
    `Skip rule: already in new_contracts OR not_found_contracts → no GeM curl (anchors=${skipSet.size})`
  );

  if (cli.dryRun) {
    let show = 0;
    for (const g of workGaps.slice(0, 10)) {
      console.log(
        `  gap ${g.after} → ${g.before} (${g.count} missing) walk ${reverse ? 'high→low' : 'low→high'}`
      );
      show += 1;
    }
    if (workGaps.length > show) console.log(`  … +${workGaps.length - show} more gaps`);
    await pool.end();
    return;
  }

  const s3 = createS3();
  const { ensureCookie } = createCookieJar();

  let saved = 0;
  let skippedNoOrder = 0;
  let skippedKnown = 0;
  let errors = 0;
  let probed = 0;
  let visited = 0;
  let lastHint = '';
  let gapsDone = 0;
  let resumeValue = parseGemc(savedCursor)?.value ?? null;

  const client = await pool.connect();
  try {
    console.log(`Probing ${workGaps.length} gaps (concurrency=${cli.concurrency})…`);

    for (const gap of workGaps) {
      if (stopRequested) break;
      if (cli.limit > 0 && probed >= cli.limit) break;

      gapsDone += 1;
      const gapKnown = await loadGapKnown(client, gap, skipSet);
      if (gapsDone === 1 || gapsDone % 25 === 0) {
        console.log(
          `  gap ${gapsDone}/${workGaps.length}: ${gap.after} → ${gap.before} (${gap.count}) already in contract/not_found=${gapKnown.found} (skip, no curl)`
        );
      }

      let startCursor = reverse ? gap.to : gap.from;
      if (resumeValue != null && resumeValue >= gap.from && resumeValue <= gap.to) {
        const next = reverse
          ? resumeValue - (cursorAlreadyDone ? 1n : 0n)
          : resumeValue + (cursorAlreadyDone ? 1n : 0n);
        if (next < gap.from || next > gap.to) {
          resumeValue = null;
          continue;
        }
        startCursor = next;
        resumeValue = null;
      } else if (resumeValue != null) {
        resumeValue = null;
      }

      const state = {
        prefix: gap.prefix,
        width: gap.width,
        reverse,
        cursor: startCursor,
        endValue: reverse ? gap.from : gap.to,
        visited: 0,
      };

      const cursorDone = () =>
        state.reverse ? state.cursor < state.endValue : state.cursor > state.endValue;

      let gapRetryBlocked = false;
      while (!stopRequested && !cursorDone()) {
        if (cli.limit > 0 && probed >= cli.limit) break;

        const want =
          cli.limit > 0
            ? Math.min(cli.concurrency, cli.limit - probed)
            : cli.concurrency;

        const { batch, skippedKnown: sk } = takeNextBatch(state, skipSet, want);
        skippedKnown += sk;
        visited += state.visited;
        state.visited = 0;
        if (!batch.length) break;

        const pending = [];
        for (const contractNumber of batch) {
          if (skipSet.has(contractNumber)) {
            skippedKnown += 1;
            continue;
          }
          if (savedCursor && cursorAlreadyDone) {
            // saved cursor number itself was already processed
            if (reverse ? contractNumber >= savedCursor : contractNumber <= savedCursor) {
              skippedKnown += 1;
              continue;
            }
          } else if (cli.startFrom) {
            if (reverse ? contractNumber > cli.startFrom : contractNumber < cli.startFrom) {
              skippedKnown += 1;
              continue;
            }
          }
          pending.push(contractNumber);
        }
        if (!pending.length) continue;

        // Claim before curl. Already in new_contracts or not_found → not returned, no GeM call.
        // A kill during curl leaves the row, so restart does not request that number again.
        const claimed = await claimForProbe(client, pending);
        const claimedSet = new Set(claimed);
        const toProbe = [];
        for (const contractNumber of pending) {
          if (!claimedSet.has(contractNumber)) {
            skipSet.add(contractNumber);
            skippedKnown += 1;
            continue;
          }
          toProbe.push(contractNumber);
        }
        if (!toProbe.length) continue;

        const results = await mapPool(toProbe, toProbe.length, async (contractNumber) => {
          lastHint = contractNumber;
          try {
            const cookie = await ensureCookie(false);
            const orderId = await fetchOrderId(contractNumber, cookie);
            return { contractNumber, status: 'found', orderId };
          } catch (err) {
            if (err?.code === 'NO_ORDER_ID') {
              return { contractNumber, status: 'miss' };
            }
            return {
              contractNumber,
              status: 'error',
              error: String(err?.message || err || '').replace(/\s+/g, ' ').trim(),
              code: err?.code,
              retryable: isRetryableError(err) || err?.retryable,
            };
          }
        });

        let cursorAdvancedTo = null;
        let retryBlocked = false;
        for (let ri = 0; ri < toProbe.length; ri++) {
          const r = results[ri];
          const contractNumber = toProbe[ri];
          if (!r) {
            retryBlocked = true;
            try {
              await releaseClaim(client, contractNumber);
            } catch (relErr) {
              console.log(`  claim release failed ${contractNumber}: ${relErr.message || relErr}`);
            }
            continue;
          }
          probed += 1;
          const keepClaim = () => {
            skipSet.add(contractNumber);
            if (!retryBlocked) cursorAdvancedTo = contractNumber;
          };
          if (r.status === 'miss') {
            skippedNoOrder += 1;
            keepClaim();
          } else if (r.status === 'found') {
            console.log(`\n======== hit ${r.contractNumber} (probed=${probed}) ========`);
            try {
              const cookie = await ensureCookie(true);
              const {
                seller,
                buyer,
                buyingMode,
                bidNumber,
                offWindow,
                contractDateIso,
              } = await saveFromPdf({
                client,
                s3,
                contractNumber: r.contractNumber,
                cookie,
                refreshCookie: ensureCookie,
                dateFilter,
              });
              saved += 1;
              try {
                await releaseClaim(client, r.contractNumber);
              } catch (relErr) {
                console.log(`  not_found cleanup failed ${r.contractNumber}: ${relErr.message || relErr}`);
              }
              skipSet.add(r.contractNumber);
              if (!retryBlocked) cursorAdvancedTo = r.contractNumber;
              const modeBit = `mode=${buyingMode}${bidNumber ? ` bid=${bidNumber}` : ''}`;
              if (offWindow) {
                console.log(
                  `      saved off-window date=${contractDateIso} → seller="${seller.company_name || seller.seller_id}" buyer="${buyer.company_name || buyer.email}" ${modeBit}`
                );
              } else {
                console.log(
                  `      saved → seller="${seller.company_name || seller.seller_id}" buyer="${buyer.company_name || buyer.email}" ${modeBit}`
                );
              }
              if (delayMs > 0) await sleep(delayMs);
            } catch (err) {
              // Captcha hit but GeM PDF body empty (common) → keep not_found claim, continue
              if (err?.code === 'EMPTY_PDF' || err?.emptyBody) {
                skippedNoOrder += 1;
                console.log(`      no PDF on GeM (0 bytes) → not_found`);
                keepClaim();
              } else if (err?.code === 'NO_CONTRACT_DATE') {
                errors += 1;
                console.log(`      ${err.message} → kept in not_found (no re-curl)`);
                keepClaim();
              } else {
                errors += 1;
                console.log(`      enrich failed: ${err.message || err}`);
                const retryable = isRetryableError(err) || err?.code === 'INVALID_PDF';
                if (retryable) {
                  retryBlocked = true;
                  try {
                    await releaseClaim(client, r.contractNumber);
                  } catch (relErr) {
                    console.log(
                      `  claim release failed ${r.contractNumber}: ${relErr.message || relErr}`
                    );
                  }
                  await ensureCookie(true);
                  if (isRetryableError(err)) await sleep(TIMEOUT_COOLDOWN_MS);
                  else await sleep(PDF_GAP_MS * 2);
                } else {
                  keepClaim();
                }
              }
            }
          } else {
            errors += 1;
            console.log(`  probe fail ${r.contractNumber}: ${r.code || 'ERROR'} — ${r.error}`);
            if (r.retryable) {
              retryBlocked = true;
              try {
                await releaseClaim(client, r.contractNumber);
              } catch (relErr) {
                console.log(`  claim release failed ${r.contractNumber}: ${relErr.message || relErr}`);
              }
              await sleep(TIMEOUT_COOLDOWN_MS);
              await ensureCookie(true);
            } else {
              keepClaim();
            }
          }
        }

        if (cursorAdvancedTo) await saveCursor(client, scope, cursorAdvancedTo);
        if (retryBlocked) {
          gapRetryBlocked = true;
          break;
        }

        if (probed > 0 && probed % 100 < cli.concurrency) {
          console.log(
            `  progress probed=${probed} saved=${saved} not_found=${skippedNoOrder} skippedKnown=${skippedKnown} gaps=${gapsDone}/${workGaps.length} cursor=${cursorAdvancedTo || savedCursor || '-'}`
          );
        }
      }

      if (!gapRetryBlocked && cursorDone()) {
        const boundary = formatGemc(gap.prefix, reverse ? gap.from : gap.to, gap.width);
        await saveCursor(client, scope, boundary);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(
    `\nAll done! GapsDone=${gapsDone}/${workGaps.length} Probed=${probed} Saved=${saved} NoOrderId=${skippedNoOrder} SkippedKnown=${skippedKnown} Errors=${errors}`
  );
  if (lastHint) console.log(`Last work: ${lastHint}`);
  if (stopRequested) {
    console.log(
      `Stopped — re-run resumes from the saved cursor and does not re-curl numbers already in new_contracts or not_found_contracts`
    );
  }
}

async function runForever() {
  for (;;) {
    try {
      await main();
      break;
    } catch (err) {
      console.error(`fatal: ${err.message || err}`);
      console.log(`auto-restart in ${Math.round(FATAL_RESTART_MS / 1000)}s...`);
      await sleep(FATAL_RESTART_MS);
      stopRequested = false;
    }
  }
}

runForever().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
