/**
 * GeM contract list scanner → stores rows in contract_lists
 *
 *   node src/gem/contracts-details.js
 *   node src/gem/contracts-details.js --reverse
 *   node src/gem/contracts-details.js --delay-3
 *   node src/gem/contracts-details.js --name "Autonomous Body" --delay-3
 *   node src/gem/contracts-details.js --parts=10 --part=1 --delay-3
 *   node src/gem/contracts-details.js --from 01-01-2021 --to 31-12-2021
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const START_DAY = '28-12-2018';
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

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI / dates / CSV
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { delaySec: 0, reverse: false, part: 0, parts: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);
    if (a === '--reverse') out.reverse = true;
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
      a === '--parts'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else out[key] = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--page=')) out.page = a.slice(7);
    else if (a.startsWith('--name=')) out.name = a.slice(7);
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
  }
  if (Number.isNaN(out.delaySec) || out.delaySec < 0) out.delaySec = 0;
  if (Number.isNaN(out.part) || out.part < 0) out.part = 0;
  if (Number.isNaN(out.parts) || out.parts < 0) out.parts = 0;
  return out;
}

/** Split array into `parts` chunks; return 1-based `part` slice */
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

function parseDDMMYYYY(d) {
  const [dd, mm, yyyy] = String(d).split('-').map(Number);
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

/** DD-MM-YYYY → YYYY-MM-DD for Postgres DATE */
function toIsoDate(dateStr) {
  const [dd, mm, yyyy] = String(dateStr).split('-').map(Number);
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const d = parseDDMMYYYY(dateStr);
  d.setDate(d.getDate() + days);
  return formatDDMMYYYY(d);
}

function isAfter(a, b) {
  return parseDDMMYYYY(a).getTime() > parseDDMMYYYY(b).getTime();
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

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function hasDuplicateInDb(client, { name, fromDate, toDate }) {
  const { rows } = await client.query(
    `SELECT 1
     FROM contract_lists
     WHERE lower(name) = lower($1)
       AND from_date = $2::date
       AND to_date = $3::date
     LIMIT 1`,
    [name, toIsoDate(fromDate), toIsoDate(toDate)]
  );
  return rows.length > 0;
}

async function saveContractList(client, { name, fromDate, toDate, pages, totalContracts }) {
  const result = await client.query(
    `INSERT INTO contract_lists (
       name, from_date, to_date, pages, total_contracts, is_scrapped
     ) VALUES ($1, $2::date, $3::date, $4, $5, FALSE)
     ON CONFLICT (name, from_date, to_date) DO UPDATE SET
       pages = EXCLUDED.pages,
       total_contracts = EXCLUDED.total_contracts,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [name, toIsoDate(fromDate), toIsoDate(toDate), pages, totalContracts]
  );
  return result.rows[0]?.id || null;
}

// ---------------------------------------------------------------------------
// HTTP / scan
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 120000;
/** Wait after a timeout before retrying the same page (GeM rate-limits deep pages). */
const TIMEOUT_COOLDOWN_MS = 60000;
/** Longer pause every N failures; also refresh cookie then. */
const LONG_COOLDOWN_MS = 180000;
const COOKIE_REFRESH_EVERY = 3;

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

async function getCookie() {
  if (COOKIE && COOKIE.trim()) return COOKIE.trim();
  const res = await axios.get(LANDING, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });
  const setCookie = res.headers['set-cookie'] || [];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

async function fetchPageOnce({ ministry, fromDate, toDate, page, cookie, delayMs }) {
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
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://gem.gov.in',
      Referer: LANDING,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': UA,
      Cookie: cookie,
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (delayMs > 0) await sleep(delayMs);
  return { data, status };
}

/**
 * Never give up on a page for timeout/network — cool down and resume same page.
 * Does not restart the whole date range (avoids re-fetching pages 0..N).
 */
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
        `    page ${page}: timeout — wait ${Math.round(waitMs / 1000)}s then resume (try ${attempt})`
      );
      await sleep(waitMs);
      if (longPause) {
        try {
          cookieRef.cookie = await getCookie();
          console.log('    cookie refreshed after long cooldown');
        } catch (cookieErr) {
          console.log(`    cookie refresh failed: ${cookieErr.message}`);
        }
      }
    }
  }
}

async function countPagesForMinistry({
  ministry,
  fromDate,
  toDate,
  startPage,
  cookieRef,
  delayMs,
}) {
  let page = startPage;
  let totalPages = 0;
  let totalContracts = 0;

  while (true) {
    const { data } = await fetchPage({
      ministry,
      fromDate,
      toDate,
      page,
      cookieRef,
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

async function scanMinistry({
  client,
  ministry,
  startDay,
  endDay,
  startPage,
  cookieRef,
  delayMs,
}) {
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

    if (await hasDuplicateInDb(client, { name: ministry, fromDate, toDate })) {
      console.log('  skip: already in contract_lists');
      skippedDup += 1;
      day = nextDate;
      continue;
    }

    const { totalPages, totalContracts } = await countPagesForMinistry({
      ministry,
      fromDate,
      toDate,
      startPage,
      cookieRef,
      delayMs,
    });

    if (totalPages === 0) {
      console.log('  no data → nextdate', formatShort(nextDate));
      skippedEmpty += 1;
      day = nextDate;
      continue;
    }

    await saveContractList(client, {
      name: ministry,
      fromDate,
      toDate,
      pages: totalPages,
      totalContracts,
    });

    savedCount += 1;
    console.log(
      `  yes  pages=${totalPages}  contracts=${totalContracts}  → contract_lists`
    );
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
  const startDay = cli.from || START_DAY;
  const endDay = cli.to || END_DAY;
  let startPage = Number(cli.page !== undefined ? cli.page : PAGE);
  if (Number.isNaN(startPage) || startPage < 0) startPage = 0;
  const delayMs = Math.round((cli.delaySec || 0) * 1000);

  const allNames = loadMinistryNames(NAMES_CSV);
  const wanted = (cli.name !== undefined ? cli.name : BUYER_MINISTRY).trim();

  let ministries = allNames;
  if (wanted) {
    const one = allNames.find((n) => n.toLowerCase() === wanted.toLowerCase());
    if (!one) {
      throw new Error(
        `Ministry "${wanted}" not found in Names CSV.\nAvailable e.g.: ${allNames.slice(0, 5).join(', ')}...`
      );
    }
    ministries = [one];
  } else {
    if (cli.reverse) ministries = [...allNames].reverse();
    if (cli.part || cli.parts) {
      const before = ministries.length;
      ministries = slicePart(ministries, cli.part, cli.parts);
      console.log(`part: ${cli.part}/${cli.parts}  (${ministries.length} of ${before} ministries)`);
    }
  }

  console.log(`ministries: ${ministries.length}${cli.reverse ? ' (reverse)' : ''}`);
  if (ministries.length) {
    console.log(`first: ${ministries[0]}`);
    console.log(`last: ${ministries[ministries.length - 1]}`);
  }
  console.log(`date scan: ${formatShort(startDay)} → ${formatShort(endDay)} (+90 day windows)`);
  console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s per request` : 'off'}`);
  console.log(`names: ${NAMES_CSV}`);
  console.log(`store: contract_lists\n`);

  const pool = createPool();
  const cookieRef = { cookie: await getCookie() };

  try {
    const client = await pool.connect();
    try {
      for (let i = 0; i < ministries.length; i++) {
        const ministry = ministries[i];
        console.log(`\n======== [${i + 1}/${ministries.length}] ${ministry} ========`);

        // Keep retrying this ministry until it finishes (timeouts auto-retry inside)
        for (;;) {
          try {
            cookieRef.cookie = await getCookie();
            const stats = await scanMinistry({
              client,
              ministry,
              startDay,
              endDay,
              startPage,
              cookieRef,
              delayMs,
            });
            console.log(
              `done: ${ministry}  saved=${stats.savedCount}  empty=${stats.skippedEmpty}  dup=${stats.skippedDup}`
            );
            break;
          } catch (err) {
            console.log(`ministry error: ${err.message}`);
            console.log('auto-restart ministry in 20s...');
            await sleep(20000);
            try {
              cookieRef.cookie = await getCookie();
            } catch {
              /* ignore */
            }
          }
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log('\nall done');
}

async function runForever() {
  for (;;) {
    try {
      await main();
      break;
    } catch (err) {
      console.error(`fatal: ${err.message || err}`);
      console.log('auto-restart script in 30s...');
      await sleep(30000);
    }
  }
}

runForever().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
