/**
 * GeM contract list resume scanner → continues paused rows in contract_lists
 *
 * Requires --is_get=true. Loads rows where is_get=TRUE, reads last saved
 * pages/total_contracts from contract_lists, and continues from that page.
 * Updates pages / total_contracts after every page; pauses again every MAX_PAGES_CHUNK.
 *
 *   node src/gem/contracts-details-updated.js --is_get=true --delay-3
 *   node src/gem/contracts-details-updated.js --parts=78 --part=41 --is_get=true --delay-3
 *   node src/gem/contracts-details-updated.js --parts=78 --part=41 --name "Autonomous Body" --is_get=true --delay-3
 *   node src/gem/contracts-details-updated.js --ministry "Autonomous Body" --is_get=true --delay-3
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const path = require('path');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BUYER_MINISTRY = '';
const BUYER_ENTITY = '';
const BUYER_STATE = '';
const DEPARTMENT = '';
const ORGANIZATION = '';
const COOKIE = '';
/** Stop after this many pages per run; set is_get=TRUE and resume with --is_get=true */
const MAX_PAGES_CHUNK = 10000;

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI / dates / CSV
// ---------------------------------------------------------------------------

function parseBool(val) {
  if (val === undefined || val === null || val === '') return false;
  const s = String(val).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function parseArgs(argv) {
  const out = { delaySec: 0, reverse: false, part: 0, parts: 0, isGet: false };
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
      a === '--ministry' ||
      a === '--part' ||
      a === '--parts' ||
      a === '--is_get'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else if (key === 'is_get') out.isGet = parseBool(val);
      else if (key === 'name' || key === 'ministry') out.name = val;
      else out[key] = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--page=')) out.page = a.slice(7);
    else if (a.startsWith('--name=')) out.name = a.slice(7);
    else if (a.startsWith('--ministry=')) out.name = a.slice(11);
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
    else if (a.startsWith('--is_get=')) out.isGet = parseBool(a.slice(9));
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

function formatShort(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('-').map(Number);
  return `${dd}-${mm}-${yyyy}`;
}

/** DD-MM-YYYY → YYYY-MM-DD for Postgres DATE */
function toIsoDate(dateStr) {
  const [dd, mm, yyyy] = String(dateStr).split('-').map(Number);
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Postgres DATE → DD-MM-YYYY */
function pgDateToDDMMYYYY(val) {
  const d = val instanceof Date ? val : new Date(val);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
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

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function getContractListRow(client, { id, name, fromDate, toDate }) {
  if (id) {
    const { rows } = await client.query(
      `SELECT id, name, from_date, to_date, pages, total_contracts, is_get
       FROM contract_lists
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  const { rows } = await client.query(
    `SELECT id, name, from_date, to_date, pages, total_contracts, is_get
     FROM contract_lists
     WHERE lower(name) = lower($1)
       AND from_date = $2::date
       AND to_date = $3::date
     LIMIT 1`,
    [name, toIsoDate(fromDate), toIsoDate(toDate)]
  );
  return rows[0] || null;
}

async function upsertProgress(client, { name, fromDate, toDate, pages, totalContracts, isGet }) {
  await client.query(
    `INSERT INTO contract_lists (
       name, from_date, to_date, pages, total_contracts, is_scrapped, is_get
     ) VALUES ($1, $2::date, $3::date, $4, $5, FALSE, $6)
     ON CONFLICT (name, from_date, to_date) DO UPDATE SET
       pages = EXCLUDED.pages,
       total_contracts = EXCLUDED.total_contracts,
       is_get = EXCLUDED.is_get,
       updated_at = CURRENT_TIMESTAMP`,
    [name, toIsoDate(fromDate), toIsoDate(toDate), pages, totalContracts, isGet]
  );
}

async function loadIsGetJobs(client, { name, part, parts }) {
  const params = [];
  let query = `
    SELECT id, name, from_date, to_date, pages, total_contracts, is_get
    FROM contract_lists
    WHERE is_get = TRUE`;

  if (name && name.trim()) {
    params.push(name.trim());
    query += ` AND lower(name) = lower($${params.length})`;
  }

  query += ` ORDER BY from_date ASC, name ASC`;

  const { rows } = await client.query(query, params);
  return slicePart(rows, part, parts);
}

// ---------------------------------------------------------------------------
// HTTP / scan
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 120000;
const TIMEOUT_COOLDOWN_MS = 60000;
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

/**
 * Scan pages incrementally.
 * Reads contract_lists.pages as the last saved page count (= next page index to fetch).
 * Example: pages=500, total_contracts=10000 → fetch page index 500 (page 501), then save 501 / 10010.
 */
async function scanRangeIncremental({
  client,
  ministry,
  fromDate,
  toDate,
  cookieRef,
  delayMs,
  jobRef = null,
  maxPagesChunk = MAX_PAGES_CHUNK,
}) {
  const row =
    jobRef &&
    (await getContractListRow(client, {
      id: jobRef.id,
      name: ministry,
      fromDate,
      toDate,
    }));

  if (!row) {
    throw new Error(`contract_lists row not found for ${ministry} (${fromDate} → ${toDate})`);
  }

  if (!row.is_get) {
    console.log(`    skip: is_get=FALSE (already complete)  pages=${row.pages}`);
    return { status: 'completed', pages: row.pages, totalContracts: row.total_contracts };
  }

  let pageIndex = Number(row.pages) || 0;
  let totalContracts = Number(row.total_contracts) || 0;
  let pagesThisRun = 0;

  console.log(
    `    start from contract_lists: page ${pageIndex + 1} (index ${pageIndex})  saved pages=${row.pages}  contracts=${row.total_contracts}`
  );

  while (true) {
    const { data } = await fetchPage({
      ministry,
      fromDate,
      toDate,
      page: pageIndex,
      cookieRef,
      delayMs,
    });

    if (!hasData(data)) {
      await upsertProgress(client, {
        name: ministry,
        fromDate,
        toDate,
        pages: pageIndex,
        totalContracts,
        isGet: false,
      });
      console.log(
        `    done: pages=${pageIndex}  contracts=${totalContracts}  is_get=FALSE`
      );
      return { status: 'completed', pages: pageIndex, totalContracts };
    }

    const count = countContracts(data);
    pageIndex += 1;
    totalContracts += count;
    pagesThisRun += 1;

    const hitChunk = pagesThisRun >= maxPagesChunk;
    await upsertProgress(client, {
      name: ministry,
      fromDate,
      toDate,
      pages: pageIndex,
      totalContracts,
      isGet: hitChunk,
    });

    console.log(
      `    page ${pageIndex} (index ${pageIndex - 1}): contracts=${count}  total pages=${pageIndex}  total contracts=${totalContracts}${hitChunk ? '  → chunk limit, is_get=TRUE' : ''}`
    );

    if (hitChunk) {
      console.log(`    paused at MAX_PAGES_CHUNK=${maxPagesChunk} — run again with --is_get=true`);
      return { status: 'paused', pages: pageIndex, totalContracts };
    }
  }
}

async function runIsGetJobs({ client, jobs, cookieRef, delayMs }) {
  let completed = 0;
  let paused = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const ministry = job.name;
    const fromDate = pgDateToDDMMYYYY(job.from_date);
    const toDate = pgDateToDDMMYYYY(job.to_date);
    const dateLabel = `${formatShort(fromDate)} to ${formatShort(toDate)}`;

    console.log(`\n======== [${i + 1}/${jobs.length}] ${ministry} ========`);
    console.log(`  range: ${dateLabel}`);

    const fresh = await getContractListRow(client, { id: job.id, name: ministry, fromDate, toDate });
    if (!fresh) {
      console.log('  skip: row not found in contract_lists');
      continue;
    }
    if (!fresh.is_get) {
      console.log(`  skip: is_get=FALSE  pages=${fresh.pages}  contracts=${fresh.total_contracts}`);
      completed += 1;
      continue;
    }

    console.log(`  contract_lists: pages=${fresh.pages}  contracts=${fresh.total_contracts}  → start page ${fresh.pages + 1}`);

    const result = await scanRangeIncremental({
      client,
      ministry,
      fromDate,
      toDate,
      cookieRef,
      delayMs,
      jobRef: fresh,
    });

    if (result.status === 'paused') paused += 1;
    else completed += 1;
  }

  return { completed, paused };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  if (!cli.isGet) {
    console.log('Stopped: --is_get=true is required to run this script.');
    console.log(
      'Example: node src/gem/contracts-details-updated.js --parts=78 --part=41 --name "Ministry Name" --is_get=true --delay-3'
    );
    process.exit(0);
  }

  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const wanted = (cli.name !== undefined ? cli.name : BUYER_MINISTRY).trim();

  console.log('mode: is_get (resume paused rows)');
  if (wanted) console.log(`ministry: ${wanted}`);
  console.log(`chunk: ${MAX_PAGES_CHUNK} pages per run before is_get=TRUE`);
  console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s per request` : 'off'}`);
  console.log('store: contract_lists\n');

  const pool = createPool();
  const cookieRef = { cookie: await getCookie() };

  try {
    const client = await pool.connect();
    try {
      const jobs = await loadIsGetJobs(client, {
        name: wanted,
        part: cli.part,
        parts: cli.parts,
      });

      if (cli.part || cli.parts) {
        console.log(`part: ${cli.part}/${cli.parts}  (${jobs.length} is_get jobs)`);
      }

      if (!jobs.length) {
        if (wanted) {
          console.log(`no contract_lists rows with is_get=TRUE for ministry "${wanted}"`);
        } else {
          console.log('no contract_lists rows with is_get=TRUE');
        }
        return;
      }

      console.log(`is_get jobs: ${jobs.length}`);
      console.log(`first: ${jobs[0].name}`);
      console.log(`last: ${jobs[jobs.length - 1].name}\n`);

      for (;;) {
        try {
          cookieRef.cookie = await getCookie();
          const stats = await runIsGetJobs({ client, jobs, cookieRef, delayMs });
          console.log(`\ndone: completed=${stats.completed}  paused=${stats.paused}`);
          break;
        } catch (err) {
          console.log(`error: ${err.message}`);
          console.log('auto-restart in 20s...');
          await sleep(20000);
          try {
            cookieRef.cookie = await getCookie();
          } catch {
            /* ignore */
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
