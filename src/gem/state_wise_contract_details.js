/**
 * GeM state-wise contract list scanner → stores rows in
 * state_wise_contract_lists + state_wise_contract_list_pages,
 * and inserts listing contracts into new_contracts (with state_id).
 *
 * Uses buyer_state (e.g. GUJARAT) instead of buyer_ministry.
 * Loads states from the `states` table.
 *
 *   node src/gem/state_wise_contract_details.js
 *   node src/gem/state_wise_contract_details.js --reverse
 *   node src/gem/state_wise_contract_details.js --delay-3
 *   node src/gem/state_wise_contract_details.js --name "Gujarat" --delay-3
 *   node src/gem/state_wise_contract_details.js --parts=10 --part=1 --delay-3
 *   node src/gem/state_wise_contract_details.js --from 10-08-2026 --to 20-08-2026
 *   node src/gem/state_wise_contract_details.js --resync
 *
 * On restart: checks state + from_date/to_date, reads last saved page_number,
 * then continues from last_page + 1 (skips finished earlier windows).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const cheerio = require('cheerio');
const { Pool, types } = require('pg');
const { parseGemContractDate } = require('../lib/htmlFields');
const { normalizeBuyingMode } = require('../lib/contractLookups');

// Return DATE as 'YYYY-MM-DD' string (avoid timezone off-by-one on resume)
types.setTypeParser(types.builtins.DATE, (val) => val);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const START_DAY = '26-03-2021';
const END_DAY = '19-06-2026';
const BUYER_MINISTRY = '';
const PAGE = '0';
const BUYER_ENTITY = '';
const DEPARTMENT = '';
const ORGANIZATION = '';
const COOKIE = '';
const MAX_PAGES = 100000;

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI / dates
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { delaySec: 0, reverse: false, part: 0, parts: 0, resync: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);
    if (a === '--reverse') out.reverse = true;
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
      a === '--state' ||
      a === '--part' ||
      a === '--parts'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else if (key === 'name' || key === 'state') out.name = val;
      else out[key] = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--page=')) out.page = a.slice(7);
    else if (a.startsWith('--name=')) out.name = a.slice(7);
    else if (a.startsWith('--state=')) out.name = a.slice(8);
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

/** DB name "Gujarat" → GeM buyer_state "GUJARAT" */
function toGemStateName(name) {
  return String(name || '')
    .trim()
    .toUpperCase();
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

async function loadStates(client) {
  const { rows } = await client.query(
    `SELECT id, name, gst_code
     FROM states
     ORDER BY name ASC`
  );
  return rows;
}

/** Postgres DATE string / Date → DD-MM-YYYY (no timezone shift) */
function pgDateToDDMMYYYY(val) {
  if (val == null || val === '') throw new Error('empty date from DB');
  // Prefer plain YYYY-MM-DD text (setTypeParser + ::text)
  const s = String(val instanceof Date ? val.toISOString() : val).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Unexpected DB date value: ${val}`);
  }
  const [yyyy, mm, dd] = s.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Last saved page for this state + date window.
 * Returns null when no rows exist yet.
 */
async function getLastSavedPage(client, stateId, fromDate, toDate) {
  const { rows } = await client.query(
    `SELECT MAX(p.page_number) AS last_page
     FROM state_wise_contract_list_pages p
     JOIN state_wise_contract_lists l ON l.id = p.state_wise_contract_list_id
     WHERE l.state_id = $1
       AND p.from_date = $2::date
       AND p.to_date = $3::date`,
    [stateId, toIsoDate(fromDate), toIsoDate(toDate)]
  );
  if (rows[0]?.last_page == null) return null;
  return Number(rows[0].last_page);
}

/**
 * Jump to the latest date window that already has pages for this state
 * (so restart does not re-walk finished earlier windows from START_DAY).
 */
async function getLatestProgress(client, stateId, startDay, endDay) {
  const { rows } = await client.query(
    `SELECT p.from_date::text AS from_date,
            p.to_date::text AS to_date,
            MAX(p.page_number) AS last_page
     FROM state_wise_contract_list_pages p
     JOIN state_wise_contract_lists l ON l.id = p.state_wise_contract_list_id
     WHERE l.state_id = $1
       AND p.from_date >= $2::date
       AND p.from_date <= $3::date
     GROUP BY p.from_date, p.to_date
     ORDER BY p.from_date DESC
     LIMIT 1`,
    [stateId, toIsoDate(startDay), toIsoDate(endDay)]
  );
  if (!rows.length) return null;
  return {
    fromDate: pgDateToDDMMYYYY(rows[0].from_date),
    toDate: pgDateToDDMMYYYY(rows[0].to_date),
    lastPage: Number(rows[0].last_page),
  };
}

async function ensureStateList(client, stateId) {
  const result = await client.query(
    `INSERT INTO state_wise_contract_lists (
       state_id, total_pages, total_contracts
     ) VALUES ($1, 0, 0)
     ON CONFLICT (state_id) DO UPDATE SET
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [stateId]
  );
  return result.rows[0].id;
}

async function refreshListTotals(client, listId) {
  const { rows } = await client.query(
    `UPDATE state_wise_contract_lists l
     SET total_pages = sub.pages,
         total_contracts = sub.contracts,
         updated_at = CURRENT_TIMESTAMP
     FROM (
       SELECT COUNT(*)::int AS pages,
              COALESCE(SUM(total_contracts), 0)::int AS contracts
       FROM state_wise_contract_list_pages
       WHERE state_wise_contract_list_id = $1
     ) sub
     WHERE l.id = $1
     RETURNING l.total_pages, l.total_contracts`,
    [listId]
  );
  return rows[0];
}

/**
 * Insert or update one page row.
 * Always leaves is_scraped=FALSE on insert.
 * On conflict: never sets is_scraped=TRUE (enricher owns that).
 * If total_contracts changes, reset is_scraped=FALSE so PDF enrich re-runs.
 */
async function upsertPageAndTotals(client, { listId, fromDate, toDate, pageNumber, totalContracts }) {
  await client.query(
    `INSERT INTO state_wise_contract_list_pages (
       state_wise_contract_list_id, from_date, to_date,
       page_number, total_contracts, is_scraped
     ) VALUES ($1, $2::date, $3::date, $4, $5, FALSE)
     ON CONFLICT (state_wise_contract_list_id, from_date, to_date, page_number) DO UPDATE SET
       total_contracts = EXCLUDED.total_contracts,
       is_scraped = CASE
         WHEN state_wise_contract_list_pages.total_contracts IS DISTINCT FROM EXCLUDED.total_contracts
           THEN FALSE
         ELSE state_wise_contract_list_pages.is_scraped
       END,
       updated_at = CURRENT_TIMESTAMP`,
    [listId, toIsoDate(fromDate), toIsoDate(toDate), pageNumber, totalContracts]
  );
  return refreshListTotals(client, listId);
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

/**
 * Insert listing fields from GeM HTML into new_contracts (seller/buyer filled later).
 */
async function upsertListingContract(client, { stateId, block }) {
  const contractNumber = String(block.contract_number || '').trim();
  if (!contractNumber) return { inserted: false, updated: false };

  const ministryId = await resolveMinistryId(client, block.ministry_label);
  const contractDate = parseGemContractDate(block.contract_date);
  const products = Array.isArray(block.products_from_html) ? block.products_from_html : [];
  const buyingMode = block.buying_mode ? normalizeBuyingMode(block.buying_mode) : null;

  const existing = await client.query(
    `SELECT id, state_id FROM new_contracts WHERE contract_number = $1 LIMIT 1`,
    [contractNumber]
  );

  if (existing.rows[0]) {
    await client.query(
      `UPDATE new_contracts SET
         state_id = COALESCE($2, state_id),
         ministry_id = COALESCE(ministry_id, $3),
         org_type = COALESCE(org_type, $4),
         org_name = COALESCE(org_name, $5),
         total_value = COALESCE(total_value, $6::numeric),
         department = COALESCE(department, $7),
         office_zone = COALESCE(office_zone, $8),
         status_of_the_contract = COALESCE(status_of_the_contract, $9),
         contract_date = COALESCE(contract_date, $10::date),
         bid_number = COALESCE(bid_number, $11),
         buyer_designation = COALESCE(buyer_designation, $12),
         buying_mode = COALESCE(buying_mode, $13),
         products = CASE
           WHEN jsonb_typeof(products) = 'array' AND jsonb_array_length(products) > 0 THEN products
           WHEN jsonb_typeof($14::jsonb) = 'array' AND jsonb_array_length($14::jsonb) > 0 THEN $14::jsonb
           ELSE products
         END
       WHERE id = $1`,
      [
        existing.rows[0].id,
        stateId,
        ministryId,
        block.org_type || null,
        block.org_name || null,
        block.total_value,
        block.department || null,
        block.office_zone || null,
        block.status_of_the_contract || null,
        contractDate,
        block.bid_number || null,
        block.buyer_designation || null,
        buyingMode,
        JSON.stringify(products),
      ]
    );
    return { inserted: false, updated: true, id: existing.rows[0].id };
  }

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
  return { inserted: true, updated: false, id: inserted.rows[0].id };
}

// ---------------------------------------------------------------------------
// HTML parsing (GeM listing page)
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

async function fetchPageOnce({ buyerState, fromDate, toDate, page, cookie, delayMs }) {
  const body = new URLSearchParams({
    buyer_entity: BUYER_ENTITY,
    buyer_ministry: BUYER_MINISTRY,
    buyer_state: buyerState,
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
async function fetchPage({ buyerState, fromDate, toDate, page, cookieRef, delayMs }) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchPageOnce({
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

async function scanPagesForWindow({
  client,
  listId,
  stateId,
  buyerState,
  fromDate,
  toDate,
  startPage,
  cookieRef,
  delayMs,
}) {
  let page = startPage;
  let savedPages = 0;
  let savedContracts = 0;
  let insertedContracts = 0;
  let updatedContracts = 0;
  let totals = null;

  while (true) {
    const { data } = await fetchPage({
      buyerState,
      fromDate,
      toDate,
      page,
      cookieRef,
      delayMs,
    });
    if (!hasData(data)) break;

    const blocks = parseContractBlocks(data);
    const count = blocks.length || countContracts(data);

    // Save page meta (is_scraped stays FALSE until PDF enrich finishes all contracts)
    const totalsRow = await upsertPageAndTotals(client, {
      listId,
      fromDate,
      toDate,
      pageNumber: page,
      totalContracts: count,
    });

    let pageInserted = 0;
    let pageUpdated = 0;
    for (const block of blocks) {
      try {
        const result = await upsertListingContract(client, { stateId, block });
        if (result.inserted) pageInserted += 1;
        else if (result.updated) pageUpdated += 1;
      } catch (err) {
        console.log(
          `      contract ${block.contract_number}: save failed: ${err.message}`
        );
      }
    }

    totals = totalsRow;
    savedPages += 1;
    savedContracts += count;
    insertedContracts += pageInserted;
    updatedContracts += pageUpdated;
    console.log(
      `    page ${page}: contracts=${count}  insert=${pageInserted} update=${pageUpdated}  is_scraped=false  → list totals pages=${totals.total_pages} contracts=${totals.total_contracts}`
    );

    page += 1;
    if (savedPages >= MAX_PAGES) {
      console.log(`    stopped at MAX_PAGES=${MAX_PAGES}`);
      break;
    }
  }

  return { savedPages, savedContracts, insertedContracts, updatedContracts, totals };
}

async function scanState({
  client,
  state,
  startDay,
  endDay,
  startPage,
  cookieRef,
  delayMs,
  resync,
}) {
  const buyerState = toGemStateName(state.name);
  const listId = await ensureStateList(client, state.id);
  let day = startDay;
  let savedCount = 0;
  let skippedEmpty = 0;
  let skippedDone = 0;
  let resumedCount = 0;
  let insertedContracts = 0;
  let updatedContracts = 0;

  // On restart: jump to latest date window that already has pages for this state
  if (!resync) {
    const progress = await getLatestProgress(client, state.id, startDay, endDay);
    if (progress) {
      day = progress.fromDate;
      console.log(
        `  resume cursor: ${state.name}  last window ${formatShort(progress.fromDate)}→${formatShort(progress.toDate)}  last_page=${progress.lastPage}  → start page=${progress.lastPage + 1}`
      );
    }
  }

  while (!isAfter(day, endDay)) {
    const fromDate = day;
    let toDate = addDays(day, 90);
    if (isAfter(toDate, endDay)) toDate = endDay;
    const dateLabel = `${formatShort(fromDate)} to ${formatShort(toDate)}`;
    const nextDate = addDays(toDate, 1);

    let page = startPage;
    let lastSaved = null;

    if (!resync) {
      lastSaved = await getLastSavedPage(client, state.id, fromDate, toDate);
      if (lastSaved != null) {
        // Continue after the last saved page for this state + date window
        page = lastSaved + 1;
        resumedCount += 1;
        console.log(
          `  range: ${dateLabel}  buyer_state=${buyerState}  last_page=${lastSaved}  → start page=${page}`
        );
      } else {
        console.log(`  range: ${dateLabel}  buyer_state=${buyerState}  start page=${page}`);
      }
    } else {
      console.log(`  range: ${dateLabel}  buyer_state=${buyerState}  (resync) start page=${page}`);
    }

    const result = await scanPagesForWindow({
      client,
      listId,
      stateId: state.id,
      buyerState,
      fromDate,
      toDate,
      startPage: page,
      cookieRef,
      delayMs,
    });

    if (result.savedPages === 0) {
      if (lastSaved != null) {
        // Already had pages; next page empty → this window is finished
        console.log(`  window already complete (last_page=${lastSaved}) → nextdate ${formatShort(nextDate)}`);
        skippedDone += 1;
      } else {
        console.log('  no data → nextdate', formatShort(nextDate));
        skippedEmpty += 1;
      }
      day = nextDate;
      continue;
    }

    savedCount += 1;
    insertedContracts += result.insertedContracts;
    updatedContracts += result.updatedContracts;
    console.log(
      `  window done  pages=${result.savedPages}  contracts=${result.savedContracts}  new_contracts insert=${result.insertedContracts} update=${result.updatedContracts}`
    );
    console.log('  nextdate:', formatShort(nextDate));
    day = nextDate;
  }

  return {
    savedCount,
    skippedEmpty,
    skippedDone,
    resumedCount,
    insertedContracts,
    updatedContracts,
  };
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

  // Validate dates early
  parseDDMMYYYY(startDay);
  parseDDMMYYYY(endDay);
  if (isAfter(startDay, endDay)) {
    throw new Error(`--from (${startDay}) must be on or before --to (${endDay})`);
  }

  const pool = createPool();
  const cookieRef = { cookie: await getCookie() };

  try {
    const client = await pool.connect();
    try {
      let states = await loadStates(client);
      if (!states.length) {
        throw new Error('No rows in states table — run migrations first');
      }

      const wanted = (cli.name || '').trim();
      if (wanted) {
        const one = states.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
        if (!one) {
          throw new Error(
            `State "${wanted}" not found in states table.\nAvailable e.g.: ${states
              .slice(0, 5)
              .map((s) => s.name)
              .join(', ')}...`
          );
        }
        states = [one];
      } else {
        if (cli.reverse) states = [...states].reverse();
        if (cli.part || cli.parts) {
          const before = states.length;
          states = slicePart(states, cli.part, cli.parts);
          console.log(`part: ${cli.part}/${cli.parts}  (${states.length} of ${before} states)`);
        }
      }

      console.log(`states: ${states.length}${cli.reverse ? ' (reverse)' : ''}`);
      if (states.length) {
        console.log(`first: ${states[0].name} → ${toGemStateName(states[0].name)}`);
        console.log(
          `last: ${states[states.length - 1].name} → ${toGemStateName(states[states.length - 1].name)}`
        );
      }
      console.log(`date scan: ${formatShort(startDay)} → ${formatShort(endDay)} (+90 day windows)`);
      console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s per request` : 'off'}`);
      console.log(`resync: ${cli.resync ? 'yes' : 'no'}`);
      console.log(`store: state_wise_contract_lists + pages + new_contracts(state_id)\n`);

      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        console.log(`\n======== [${i + 1}/${states.length}] ${state.name} ========`);

        for (;;) {
          try {
            cookieRef.cookie = await getCookie();
            const stats = await scanState({
              client,
              state,
              startDay,
              endDay,
              startPage,
              cookieRef,
              delayMs,
              resync: cli.resync,
            });
            console.log(
              `done: ${state.name}  windows=${stats.savedCount}  empty=${stats.skippedEmpty}  done_windows=${stats.skippedDone}  resumed=${stats.resumedCount}  contracts_insert=${stats.insertedContracts}  contracts_update=${stats.updatedContracts}`
            );
            break;
          } catch (err) {
            console.log(`state error: ${err.message}`);
            console.log('auto-restart state in 20s...');
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
