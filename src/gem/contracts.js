/**
 * GeM View Contracts — auto scan ministries × 90-day windows (2016 → 2026)
 *
 *   node src/gem/contracts.js
 *   node src/gem/contracts.js --reverse
 *   node src/gem/contracts.js --delay-3
 *   node src/gem/contracts.js --name "Autonomous Body" --delay-3
 *   node src/gem/contracts.js --from 01-01-2021 --to 31-12-2021
 *
 * - Loads all ministry names from Names CSV into an array
 * - --reverse → start from last ministry in Names CSV
 * - For each ministry: walks 90-day ranges from START → END
 * - No data / page 0 empty → next date
 * - Duplicate date → skip insert, next date
 * - Has data → save Name, date, pages to results CSV
 * - Ministry done → next ministry
 * - --delay-3 → 3s delay after every request (no flag = no delay)
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Edit these (CLI flags override)
// ---------------------------------------------------------------------------

/** Scan window start / end (DD-MM-YYYY) */
const START_DAY = '01-01-2016';
const END_DAY = '31-12-2026';

/** Optional: only this ministry (must exist in Names CSV). Empty = all. */
const BUYER_MINISTRY = '';

/** Start page (0 = first page) */
const PAGE = '0';

const BUYER_ENTITY = '';
const BUYER_STATE = '';
const DEPARTMENT = '';
const ORGANIZATION = '';

/** Optional; leave empty to auto-fetch a fresh session cookie */
const COOKIE = '';

/** Safety cap so an endless API response cannot loop forever */
const MAX_PAGES = 500;

/** Source: ministry names only */
const NAMES_CSV = path.join(__dirname, 'Untitled spreadsheet - Names.csv');

/** Output results */
const RESULTS_CSV = path.join(__dirname, 'contracts-results.csv');

// ---------------------------------------------------------------------------

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { delaySec: 0, reverse: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    if (a === '--reverse') {
      out.reverse = true;
    } else if (delayMatch) {
      out.delaySec = Number(delayMatch[1]);
    } else if (a === '--delay' || a === '--from' || a === '--to' || a === '--page' || a === '--name') {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else out[key] = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--page=')) out.page = a.slice(7);
    else if (a.startsWith('--name=')) out.name = a.slice(7);
  }
  if (Number.isNaN(out.delaySec) || out.delaySec < 0) out.delaySec = 0;
  return out;
}

function parseDDMMYYYY(d) {
  const [dd, mm, yyyy] = d.split('-').map(Number);
  if (!dd || !mm || !yyyy) throw new Error(`Invalid date: ${d} (use DD-MM-YYYY)`);
  return new Date(yyyy, mm - 1, dd);
}

function formatDDMMYYYY(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Display like 1-1-2016 */
function formatShort(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('-').map(Number);
  return `${dd}-${mm}-${yyyy}`;
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
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      cur = '';
    } else if (ch === '\r') {
      // skip
    } else {
      cur += ch;
    }
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

/** Read ministry names from Names CSV → array */
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

  const rows = parsed.slice(1).map((cols) => ({
    name: (cols[nameIdx] || '').trim(),
    date: dateIdx >= 0 ? (cols[dateIdx] || '').trim() : '',
    pages: pagesIdx >= 0 ? (cols[pagesIdx] || '').trim() : '',
  })).filter((r) => r.name);

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
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://gem.gov.in',
      Referer: LANDING,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': UA,
      Cookie: cookie,
    },
    timeout: 60000,
    validateStatus: () => true,
  });

  if (delayMs > 0) await sleep(delayMs);
  return { data, status };
}

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

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const startDay = cli.from || START_DAY;
  const endDay = cli.to || END_DAY;
  let startPage = Number(cli.page !== undefined ? cli.page : PAGE);
  if (Number.isNaN(startPage) || startPage < 0) startPage = 0;
  const delayMs = Math.round((cli.delaySec || 0) * 1000);

  const allNames = loadMinistryNames(NAMES_CSV);
  const wanted = (cli.name !== undefined ? cli.name : BUYER_MINISTRY).trim();

  /** ministries array from Names CSV */
  let ministries = allNames;
  if (wanted) {
    const one = allNames.find((n) => n.toLowerCase() === wanted.toLowerCase());
    if (!one) {
      throw new Error(
        `Ministry "${wanted}" not found in Names CSV.\nAvailable e.g.: ${allNames.slice(0, 5).join(', ')}...`
      );
    }
    ministries = [one];
  } else if (cli.reverse) {
    ministries = [...allNames].reverse();
  }

  console.log(`ministries: ${ministries.length}${cli.reverse ? ' (reverse)' : ''}`);
  if (ministries.length) console.log(`first: ${ministries[0]}`);
  console.log(`date scan: ${formatShort(startDay)} → ${formatShort(endDay)} (+90 day windows)`);
  console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s per request` : 'off'}`);
  console.log(`names: ${NAMES_CSV}`);
  console.log(`results: ${RESULTS_CSV}\n`);

  let cookie = await getCookie();

  for (let i = 0; i < ministries.length; i++) {
    const ministry = ministries[i];
    console.log(`\n======== [${i + 1}/${ministries.length}] ${ministry} ========`);

    // refresh cookie each ministry (long runs)
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
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
