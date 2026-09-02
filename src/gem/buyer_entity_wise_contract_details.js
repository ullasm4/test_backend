/**
 * GeM buyer-entity contract list scanner → stores rows in
 * buyer_entity_wise_contract_lists + buyer_entity_wise_contract_list_pages,
 * and inserts listing contracts into new_contracts (with buyer_entity_id).
 *
 * Uses buyer_entity (e.g. "Department of Agricultural Research and Education (DARE)")
 * instead of buyer_state. Loads entities from the `buyer_entities` table.
 *
 * Date windows are calendar months (1st → last day), not 90-day blocks.
 *
 *   node src/gem/buyer_entity_wise_contract_details.js --auto --delay-3
 *   node src/gem/buyer_entity_wise_contract_details.js
 *   node src/gem/buyer_entity_wise_contract_details.js --entity "Department of Agricultural Research and Education (DARE)" --delay-3
 *   node src/gem/buyer_entity_wise_contract_details.js --entity "Department of Agricultural Research and Education (DARE)" --month 08-2026
 *   node src/gem/buyer_entity_wise_contract_details.js --from 23-08-2026 --to 02-09-2026 --down-to-top
 *   node src/gem/buyer_entity_wise_contract_details.js --parts=10 --part=1 --delay-3
 *   node src/gem/buyer_entity_wise_contract_details.js --auto --worker-loop --parts=10 --part=1 --delay-3
 *   node src/gem/buyer_entity_wise_contract_details.js --resync
 *
 * --auto (default when no --from / --to / --month):
 *   entity 1 → 2024 Jan–Dec → 2025 → 2026 Jan–Aug → entity 2 → … → exit
 *
 * Order:
 *   --down-to-top   months oldest → newest (Jan → Feb → …)  [default]
 *   --top-to-down   months newest → oldest (Aug → Jul → …)
 *   --reverse       reverse entity list order (A→Z becomes Z→A)
 *
 * On restart: checks entity + from_date/to_date, reads last saved page_number,
 * then continues from last_page + 1 (skips finished earlier windows).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios = require('axios');
const cheerio = require('cheerio');
const { Pool, types } = require('pg');
const { parseGemContractDate } = require('../lib/htmlFields');
const { normalizeBuyingMode } = require('../lib/contractLookups');

types.setTypeParser(types.builtins.DATE, (val) => val);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const START_DAY = '26-03-2021';
const END_DAY = '19-06-2026';
const PAGE = '0';
const MAX_PAGES = 100000;

/** Default years for --auto mode (matches buyerEntityWiseYear.sh) */
const AUTO_YEARS = [2024, 2025, 2026];
/** 2026 only scans Jan–Aug in --auto mode */
const AUTO_YEAR_2026_MAX_MONTH = 8;
/** When a worker has no entities in its slice, wait and re-query pending count */
const WORKER_IDLE_MS = 15000;

const URL = 'https://gem.gov.in/view_contracts/contract_details';
const LANDING = 'https://gem.gov.in/view_contracts';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const COOKIE = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CLI / dates
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    delaySec: 0,
    reverse: false,
    part: 0,
    parts: 0,
    resync: false,
    order: 'down-to-top',
    month: '',
    entity: '',
    years: '',
    auto: false,
    workerLoop: false,
    priorityEntities: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const delayMatch = a.match(/^--delay-(\d+(?:\.\d+)?)$/);
    const partSlash = a.match(/^--part=(\d+)\/(\d+)$/);
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--auto') out.auto = true;
    else if (a === '--worker-loop' || a === '--worker') out.workerLoop = true;
    else if (a === '--reverse') out.reverse = true;
    else if (a === '--resync') out.resync = true;
    else if (a === '--down-to-top' || a === '--downtotop' || a === '--downottop') {
      out.order = 'down-to-top';
    } else if (a === '--top-to-down' || a === '--toptodown' || a === '--toptdown') {
      out.order = 'top-to-down';
    } else if (delayMatch) out.delaySec = Number(delayMatch[1]);
    else if (partSlash) {
      out.part = Number(partSlash[1]);
      out.parts = Number(partSlash[2]);
    } else if (
      a === '--delay' ||
      a === '--from' ||
      a === '--to' ||
      a === '--page' ||
      a === '--name' ||
      a === '--entity' ||
      a === '--years' ||
      a === '--priority-entities' ||
      a === '--month' ||
      a === '--part' ||
      a === '--parts' ||
      a === '--order'
    ) {
      const key = a.slice(2);
      const val = argv[++i] ?? '';
      if (key === 'delay') out.delaySec = Number(val);
      else if (key === 'part') out.part = Number(val);
      else if (key === 'parts') out.parts = Number(val);
      else if (key === 'name' || key === 'entity') out.entity = val;
      else if (key === 'years') out.years = val;
      else if (key === 'priority-entities') out.priorityEntities = val;
      else if (key === 'month') out.month = val;
      else if (key === 'order') {
        const o = String(val).toLowerCase().replace(/_/g, '-');
        if (o === 'down-to-top' || o === 'downtotop' || o === 'downottop') out.order = 'down-to-top';
        else if (o === 'top-to-down' || o === 'toptodown' || o === 'toptdown') out.order = 'top-to-down';
        else throw new Error(`Unknown --order "${val}" (use down-to-top or top-to-down)`);
      } else out[key] = val;
    } else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
    else if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--page=')) out.page = a.slice(7);
    else if (a.startsWith('--name=')) out.entity = a.slice(7);
    else if (a.startsWith('--entity=')) out.entity = a.slice(9);
    else if (a.startsWith('--years=')) out.years = a.slice(8);
    else if (a.startsWith('--priority-entities=')) out.priorityEntities = a.slice(20);
    else if (a.startsWith('--month=')) out.month = a.slice(8);
    else if (a.startsWith('--order=')) {
      const o = a.slice(8).toLowerCase().replace(/_/g, '-');
      if (o === 'down-to-top' || o === 'downtotop' || o === 'downottop') out.order = 'down-to-top';
      else if (o === 'top-to-down' || o === 'toptodown' || o === 'toptdown') out.order = 'top-to-down';
      else throw new Error(`Unknown --order "${a.slice(8)}" (use down-to-top or top-to-down)`);
    } else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
  }
  if (Number.isNaN(out.delaySec) || out.delaySec < 0) out.delaySec = 0;
  if (Number.isNaN(out.part) || out.part < 0) out.part = 0;
  if (Number.isNaN(out.parts) || out.parts < 0) out.parts = 0;
  return out;
}

function printHelp() {
  console.log(`GeM buyer-entity contract list scanner

Usage:
  node src/gem/buyer_entity_wise_contract_details.js [options]

Options:
  --auto               Pending entities one-by-one: scrape all months → next → stop when all done
  --years YYYY,...     Years for --auto (default ${AUTO_YEARS.join(',')}; 2026 = Jan–Aug)
  --priority-entities "A,B"  Process these names first (in order), then remaining pending
  --entity "NAME"      Scrape only this one entity (--auto: single run, then exit)
  --month MM-YYYY      Scan only that calendar month (e.g. 08-2026 or 2026-08)
  --from DD-MM-YYYY    Scan start date (default ${START_DAY} without --auto)
  --to DD-MM-YYYY      Scan end date (default ${END_DAY} without --auto)
  --down-to-top        Months oldest → newest (default)
  --top-to-down        Months newest → oldest
  --order MODE         Same as above: down-to-top | top-to-down
  --reverse            Reverse entity list order
  --parts N --part K   Split entities into N parts; run part K
  --worker-loop        With --auto + --part/--parts: re-query pending entities after
                       each batch; re-assign parts until all entities are complete
  --delay N / --delay-N  Seconds between requests
  --page N             Start page within a window (default 0)
  --resync             Re-scan windows from page 0 (ignore resume cursor)
  --help               Show this help

Windows are always calendar months (clipped to --from / --to).

Example (matches GeM curl):
  node src/gem/buyer_entity_wise_contract_details.js \\
    --entity "Department of Agricultural Research and Education (DARE)" \\
    --from 23-08-2026 --to 02-09-2026

Example (same as buyerEntityWiseYear.sh):
  node src/gem/buyer_entity_wise_contract_details.js --auto --delay-3

Example (mainPartWise.sh worker — part 1 of 10, loops until all entities done):
  node src/gem/buyer_entity_wise_contract_details.js --auto --worker-loop --parts=10 --part=1 --delay-3
`);
}

function parseYearsArg(yearsStr) {
  const raw = String(yearsStr || '').trim();
  if (!raw) return [...AUTO_YEARS];
  const years = raw
    .split(',')
    .map((y) => Number(String(y).trim()))
    .filter((y) => y >= 1900 && y <= 2100);
  if (!years.length) {
    throw new Error(`Invalid --years "${raw}" (use comma-separated years e.g. 2024,2025,2026)`);
  }
  return years;
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function monthsForYear(year) {
  const maxMonth = year === 2026 ? AUTO_YEAR_2026_MAX_MONTH : 12;
  return Array.from({ length: maxMonth }, (_, i) => i + 1);
}

/** One calendar month job per entry (matches buyerEntityWiseYear.sh). */
function buildYearMonthJobs(years) {
  const jobs = [];
  for (const year of years) {
    for (const month of monthsForYear(year)) {
      const mm = String(month).padStart(2, '0');
      const lastDay = String(lastDayOfMonth(year, month)).padStart(2, '0');
      jobs.push({
        year,
        month,
        fromDate: `01-${mm}-${year}`,
        toDate: `${lastDay}-${mm}-${year}`,
      });
    }
  }
  return jobs;
}

function nowLabel() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function parsePriorityEntitiesArg(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function shouldUseAutoYearMode(cli) {
  if (cli.auto) return true;
  return !cli.from && !cli.to && !cli.month;
}

function parseMonthArg(monthStr, fallbackYear) {
  const raw = String(monthStr || '').trim();
  if (!raw) return null;

  let year;
  let month;

  let m = raw.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) {
    month = Number(m[1]);
    year = Number(m[2]);
  } else {
    m = raw.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]);
    } else {
      m = raw.match(/^(\d{1,2})$/);
      if (m) {
        month = Number(m[1]);
        year = Number(fallbackYear);
      }
    }
  }

  if (!year || !month || month < 1 || month > 12) {
    throw new Error(
      `Invalid --month "${raw}" (use MM-YYYY, YYYY-MM, or MM e.g. 08-2026)`
    );
  }

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);
  return { from: formatDDMMYYYY(from), to: formatDDMMYYYY(to) };
}

function startOfMonth(dateStr) {
  const d = parseDDMMYYYY(dateStr);
  return formatDDMMYYYY(new Date(d.getFullYear(), d.getMonth(), 1));
}

function endOfMonth(dateStr) {
  const d = parseDDMMYYYY(dateStr);
  return formatDDMMYYYY(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function nextMonthStart(dateStr) {
  const d = parseDDMMYYYY(dateStr);
  return formatDDMMYYYY(new Date(d.getFullYear(), d.getMonth() + 1, 1));
}

function isBefore(a, b) {
  return parseDDMMYYYY(a).getTime() < parseDDMMYYYY(b).getTime();
}

function buildMonthWindows(startDay, endDay) {
  const windows = [];
  let cursor = startOfMonth(startDay);
  const lastMonth = startOfMonth(endDay);

  while (!isAfter(cursor, lastMonth)) {
    let fromDate = cursor;
    let toDate = endOfMonth(cursor);
    if (isBefore(fromDate, startDay)) fromDate = startDay;
    if (isAfter(toDate, endDay)) toDate = endDay;
    if (!isAfter(fromDate, toDate)) {
      windows.push({ fromDate, toDate });
    }
    cursor = nextMonthStart(cursor);
  }
  return windows;
}

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

function toIsoDate(dateStr) {
  const [dd, mm, yyyy] = String(dateStr).split('-').map(Number);
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
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

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function loadBuyerEntities(client) {
  const { rows } = await client.query(
    `SELECT id, name
     FROM buyer_entities
     ORDER BY name ASC`
  );
  return rows;
}

/** Entities not yet fully listing-scanned for --auto / --worker-loop. */
async function loadPendingBuyerEntities(client) {
  const { rows } = await client.query(
    `SELECT be.id, be.name
     FROM buyer_entities be
     LEFT JOIN buyer_entity_wise_contract_lists l ON l.buyer_entity_id = be.id
     WHERE COALESCE(l.listing_complete, FALSE) = FALSE
     ORDER BY be.name ASC`
  );
  return rows;
}

async function countPendingBuyerEntities(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM buyer_entities be
     LEFT JOIN buyer_entity_wise_contract_lists l ON l.buyer_entity_id = be.id
     WHERE COALESCE(l.listing_complete, FALSE) = FALSE`
  );
  return rows[0]?.total ?? 0;
}

async function markEntityListingComplete(client, buyerEntityId) {
  await ensureEntityList(client, buyerEntityId);
  await client.query(
    `UPDATE buyer_entity_wise_contract_lists
     SET listing_complete = TRUE,
         updated_at = CURRENT_TIMESTAMP
     WHERE buyer_entity_id = $1`,
    [buyerEntityId]
  );
}

function pgDateToDDMMYYYY(val) {
  if (val == null || val === '') throw new Error('empty date from DB');
  const s = String(val instanceof Date ? val.toISOString() : val).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Unexpected DB date value: ${val}`);
  }
  const [yyyy, mm, dd] = s.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

async function getLastSavedPage(client, buyerEntityId, fromDate, toDate) {
  const { rows } = await client.query(
    `SELECT MAX(p.page_number) AS last_page
     FROM buyer_entity_wise_contract_list_pages p
     JOIN buyer_entity_wise_contract_lists l ON l.id = p.buyer_entity_wise_contract_list_id
     WHERE l.buyer_entity_id = $1
       AND p.from_date = $2::date
       AND p.to_date = $3::date`,
    [buyerEntityId, toIsoDate(fromDate), toIsoDate(toDate)]
  );
  if (rows[0]?.last_page == null) return null;
  return Number(rows[0].last_page);
}

async function getLatestProgress(client, buyerEntityId, startDay, endDay) {
  const { rows } = await client.query(
    `SELECT p.from_date::text AS from_date,
            p.to_date::text AS to_date,
            MAX(p.page_number) AS last_page
     FROM buyer_entity_wise_contract_list_pages p
     JOIN buyer_entity_wise_contract_lists l ON l.id = p.buyer_entity_wise_contract_list_id
     WHERE l.buyer_entity_id = $1
       AND p.from_date >= $2::date
       AND p.from_date <= $3::date
     GROUP BY p.from_date, p.to_date
     ORDER BY p.from_date DESC
     LIMIT 1`,
    [buyerEntityId, toIsoDate(startDay), toIsoDate(endDay)]
  );
  if (!rows.length) return null;
  return {
    fromDate: pgDateToDDMMYYYY(rows[0].from_date),
    toDate: pgDateToDDMMYYYY(rows[0].to_date),
    lastPage: Number(rows[0].last_page),
  };
}

async function ensureEntityList(client, buyerEntityId) {
  const result = await client.query(
    `INSERT INTO buyer_entity_wise_contract_lists (
       buyer_entity_id, total_pages, total_contracts
     ) VALUES ($1, 0, 0)
     ON CONFLICT (buyer_entity_id) DO UPDATE SET
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [buyerEntityId]
  );
  return result.rows[0].id;
}

async function refreshListTotals(client, listId) {
  const { rows } = await client.query(
    `UPDATE buyer_entity_wise_contract_lists l
     SET total_pages = sub.pages,
         total_contracts = sub.contracts,
         updated_at = CURRENT_TIMESTAMP
     FROM (
       SELECT COUNT(*)::int AS pages,
              COALESCE(SUM(total_contracts), 0)::int AS contracts
       FROM buyer_entity_wise_contract_list_pages
       WHERE buyer_entity_wise_contract_list_id = $1
     ) sub
     WHERE l.id = $1
     RETURNING l.total_pages, l.total_contracts`,
    [listId]
  );
  return rows[0];
}

async function upsertPageAndTotals(client, { listId, fromDate, toDate, pageNumber, totalContracts }) {
  await client.query(
    `INSERT INTO buyer_entity_wise_contract_list_pages (
       buyer_entity_wise_contract_list_id, from_date, to_date,
       page_number, total_contracts, is_scraped
     ) VALUES ($1, $2::date, $3::date, $4, $5, FALSE)
     ON CONFLICT (buyer_entity_wise_contract_list_id, from_date, to_date, page_number) DO UPDATE SET
       total_contracts = EXCLUDED.total_contracts,
       is_scraped = CASE
         WHEN buyer_entity_wise_contract_list_pages.total_contracts IS DISTINCT FROM EXCLUDED.total_contracts
           THEN FALSE
         ELSE buyer_entity_wise_contract_list_pages.is_scraped
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

async function upsertListingContract(client, { buyerEntityId, block }) {
  const contractNumber = String(block.contract_number || '').trim();
  if (!contractNumber) return { inserted: false, updated: false };
  if (!buyerEntityId) {
    throw new Error(`buyer_entity_id required for contract ${contractNumber}`);
  }

  const ministryId = await resolveMinistryId(client, block.ministry_label);
  const contractDate = parseGemContractDate(block.contract_date);
  const products = Array.isArray(block.products_from_html) ? block.products_from_html : [];
  const buyingMode = block.buying_mode ? normalizeBuyingMode(block.buying_mode) : null;

  const existing = await client.query(
    `SELECT id, buyer_entity_id FROM new_contracts WHERE contract_number = $1 LIMIT 1`,
    [contractNumber]
  );

  if (existing.rows[0]) {
    await client.query(
      `UPDATE new_contracts SET
         buyer_entity_id = $2,
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
        buyerEntityId,
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
       buyer_entity_id, ministry_id, contract_number, org_type, org_name,
       total_value, department, office_zone, status_of_the_contract,
       products, contract_date, bid_number, buyer_designation, buying_mode
     ) VALUES (
       $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9,
       $10::jsonb, $11::date, $12, $13, $14
     )
     RETURNING id`,
    [
      buyerEntityId,
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
// HTML parsing
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

async function fetchPageOnce({ buyerEntityName, fromDate, toDate, page, cookie, delayMs }) {
  const body = new URLSearchParams({
    buyer_entity: buyerEntityName,
    buyer_ministry: '',
    buyer_state: '',
    fromDate,
    toDate,
    department: '',
    organization: '',
    page: String(page),
  });

  const { data, status } = await axios.post(URL, body.toString(), {
    headers: {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
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

async function fetchPage({ buyerEntityName, fromDate, toDate, page, cookieRef, delayMs }) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchPageOnce({
        buyerEntityName,
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
  buyerEntityId,
  buyerEntityName,
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
      buyerEntityName,
      fromDate,
      toDate,
      page,
      cookieRef,
      delayMs,
    });
    if (!hasData(data)) break;

    const blocks = parseContractBlocks(data);
    const count = blocks.length || countContracts(data);

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
        const result = await upsertListingContract(client, { buyerEntityId, block });
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

async function scanBuyerEntity({
  client,
  entity,
  startDay,
  endDay,
  startPage,
  cookieRef,
  delayMs,
  resync,
  order = 'down-to-top',
}) {
  const buyerEntityName = String(entity.name || '').trim();
  const listId = await ensureEntityList(client, entity.id);
  let savedCount = 0;
  let skippedEmpty = 0;
  let skippedDone = 0;
  let resumedCount = 0;
  let insertedContracts = 0;
  let updatedContracts = 0;

  let windows = buildMonthWindows(startDay, endDay);
  const topToDown = order === 'top-to-down';
  if (topToDown) windows = [...windows].reverse();

  console.log(
    `  months: ${windows.length}  order=${topToDown ? 'top-to-down (newest → oldest)' : 'down-to-top (oldest → newest)'}`
  );
  if (windows.length) {
    console.log(
      `  first month: ${formatShort(windows[0].fromDate)} → ${formatShort(windows[0].toDate)}`
    );
    console.log(
      `  last month:  ${formatShort(windows[windows.length - 1].fromDate)} → ${formatShort(windows[windows.length - 1].toDate)}`
    );
  }

  if (!resync && !topToDown) {
    const progress = await getLatestProgress(client, entity.id, startDay, endDay);
    if (progress) {
      const idx = windows.findIndex(
        (w) => w.fromDate === progress.fromDate && w.toDate === progress.toDate
      );
      if (idx >= 0) {
        windows = windows.slice(idx);
        console.log(
          `  resume cursor: ${entity.name}  last window ${formatShort(progress.fromDate)}→${formatShort(progress.toDate)}  last_page=${progress.lastPage}  → start page=${progress.lastPage + 1}`
        );
      }
    }
  }

  for (let i = 0; i < windows.length; i++) {
    const { fromDate, toDate } = windows[i];
    const dateLabel = `${formatShort(fromDate)} to ${formatShort(toDate)}`;
    const next = windows[i + 1];
    const nextLabel = next
      ? `${formatShort(next.fromDate)} to ${formatShort(next.toDate)}`
      : 'done';

    let page = startPage;
    let lastSaved = null;

    if (!resync) {
      lastSaved = await getLastSavedPage(client, entity.id, fromDate, toDate);
      if (lastSaved != null) {
        page = lastSaved + 1;
        resumedCount += 1;
        console.log(
          `  range: ${dateLabel}  buyer_entity=${buyerEntityName}  last_page=${lastSaved}  → start page=${page}`
        );
      } else {
        console.log(`  range: ${dateLabel}  buyer_entity=${buyerEntityName}  start page=${page}`);
      }
    } else {
      console.log(`  range: ${dateLabel}  buyer_entity=${buyerEntityName}  (resync) start page=${page}`);
    }

    const result = await scanPagesForWindow({
      client,
      listId,
      buyerEntityId: entity.id,
      buyerEntityName,
      fromDate,
      toDate,
      startPage: page,
      cookieRef,
      delayMs,
    });

    if (result.savedPages === 0) {
      if (lastSaved != null) {
        console.log(
          `  window already complete (last_page=${lastSaved}) → ${topToDown ? 'prev month' : 'next month'} ${nextLabel}`
        );
        skippedDone += 1;
      } else {
        console.log(`  no data → ${topToDown ? 'prev month' : 'next month'} ${nextLabel}`);
        skippedEmpty += 1;
      }
      continue;
    }

    savedCount += 1;
    insertedContracts += result.insertedContracts;
    updatedContracts += result.updatedContracts;
    console.log(
      `  window done  pages=${result.savedPages}  contracts=${result.savedContracts}  new_contracts insert=${result.insertedContracts} update=${result.updatedContracts}`
    );
    console.log(`  ${topToDown ? 'prev month' : 'next month'}:`, nextLabel);
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

async function scanBuyerEntityWithRetry({
  client,
  entity,
  startDay,
  endDay,
  startPage,
  cookieRef,
  delayMs,
  resync,
  order,
}) {
  for (;;) {
    try {
      cookieRef.cookie = await getCookie();
      return await scanBuyerEntity({
        client,
        entity,
        startDay,
        endDay,
        startPage,
        cookieRef,
        delayMs,
        resync,
        order,
      });
    } catch (err) {
      console.log(`entity error: ${err.message}`);
      console.log('auto-restart entity in 20s...');
      await sleep(20000);
      try {
        cookieRef.cookie = await getCookie();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Same flow as buyerEntityWiseYear.sh:
 * entity 1 → year/month jobs → entity 2 → … → exit when all done.
 */
async function runAutoYearWiseSequential({
  client,
  entities,
  years,
  cookieRef,
  delayMs,
  resync,
  order,
  markComplete = false,
  workerLabel = '',
}) {
  const jobs = buildYearMonthJobs(years);
  const totalJobs = jobs.length * entities.length;
  let jobNum = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  const label = workerLabel ? ` [worker ${workerLabel}]` : '';

  if (!workerLabel) {
    console.log('==============================================');
    console.log(' Buyer Entity Wise Contract Scraper (sequential)');
    console.log('==============================================');
    console.log(`Years    : ${years.join(' ')}`);
    console.log(`Entities : ${entities.length}`);
    console.log(`Delay    : ${delayMs > 0 ? `${delayMs / 1000}s per request` : 'off'}`);
    console.log(`Total jobs: ${totalJobs} (entity × year × month)`);
    console.log('Mode     : one job at a time; next starts when previous finishes');
    console.log('==============================================\n');
  }

  for (let ei = 0; ei < entities.length; ei++) {
    const entity = entities[ei];
    console.log(`\n##############################################${label}`);
    console.log(` ENTITY [${ei + 1}/${entities.length}]: ${entity.name}`);
    console.log('##############################################');

    for (const year of years) {
      const yearJobs = jobs.filter((j) => j.year === year);
      const monthNums = yearJobs.map((j) => j.month);

      console.log('\n==============================================');
      console.log(` YEAR: ${year}  |  Entity: ${entity.name}`);
      console.log(` Months: ${monthNums.join(' ')}`);
      console.log('==============================================');

      for (const job of yearJobs) {
        jobNum += 1;
        console.log(`\n── Job ${jobNum}/${totalJobs} ── ${entity.name}${label}`);
        console.log(`   ${formatShort(job.fromDate)} → ${formatShort(job.toDate)}`);
        console.log(`   started: ${nowLabel()}`);

        const stats = await scanBuyerEntityWithRetry({
          client,
          entity,
          startDay: job.fromDate,
          endDay: job.toDate,
          startPage: 0,
          cookieRef,
          delayMs,
          resync,
          order,
        });

        totalInserted += stats.insertedContracts;
        totalUpdated += stats.updatedContracts;

        console.log(`   finished: ${nowLabel()}`);
        console.log(
          `   window insert=${stats.insertedContracts} update=${stats.updatedContracts}`
        );
      }
    }

    if (markComplete) {
      await markEntityListingComplete(client, entity.id);
    }

    console.log(`\n✓ Entity complete [${ei + 1}/${entities.length}]: ${entity.name}${label}`);
  }

  if (!workerLabel) {
    console.log('\n==============================================');
    console.log(` All done — ${totalJobs} job(s) finished.`);
    console.log(` Entities: ${entities.length}`);
    console.log(` Contracts insert=${totalInserted} update=${totalUpdated}`);
    console.log(` Finished: ${nowLabel()}`);
    console.log('==============================================');
  }

  return { totalInserted, totalUpdated, totalJobs };
}

/**
 * buyerEntityWiseYear.sh flow:
 *   1. Pick next pending entity (priority list first, else first pending by name)
 *   2. Scrape all year/month windows for that entity
 *   3. Mark listing_complete
 *   4. Re-query pending → repeat until none left → stop
 */
async function runAutoPendingSequentialLoop({
  client,
  years,
  priorityNames,
  cookieRef,
  delayMs,
  resync,
  order,
}) {
  const priorityQueue = [...priorityNames];
  let totalEntitiesDone = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  console.log('==============================================');
  console.log(' Buyer Entity Scraper — pending sequential loop');
  console.log('==============================================');
  console.log(`Years    : ${years.join(' ')}`);
  console.log(`Delay    : ${delayMs > 0 ? `${delayMs / 1000}s per request` : 'off'}`);
  if (priorityQueue.length) {
    console.log(`Priority : ${priorityQueue.join(' → ')}`);
  }
  console.log('Mode     : complete one entity → fetch next pending → stop when all done');
  console.log('==============================================\n');

  for (;;) {
    const pendingTotal = await countPendingBuyerEntities(client);
    if (pendingTotal === 0) {
      console.log('\n==============================================');
      console.log(' All buyer entities listing complete — stopping');
      console.log(` Entities scraped: ${totalEntitiesDone}`);
      console.log(` Contracts insert=${totalInserted} update=${totalUpdated}`);
      console.log(` Finished: ${nowLabel()}`);
      console.log('==============================================');
      break;
    }

    const pending = await loadPendingBuyerEntities(client);
    let entity = null;

    while (priorityQueue.length && !entity) {
      const wantedName = priorityQueue.shift();
      entity = pending.find((e) => e.name.toLowerCase() === wantedName.toLowerCase()) || null;
      if (!entity) {
        console.log(`Priority skip (done or missing): ${wantedName}`);
      }
    }

    if (!entity) {
      entity = pending[0];
    }

    console.log(
      `\n>>> Next entity (${pendingTotal} pending): ${entity.name}  [${totalEntitiesDone + 1}]`
    );

    const stats = await runAutoYearWiseSequential({
      client,
      entities: [entity],
      years,
      cookieRef,
      delayMs,
      resync,
      order,
      markComplete: true,
      workerLabel: '',
    });

    totalEntitiesDone += 1;
    totalInserted += stats.totalInserted;
    totalUpdated += stats.totalUpdated;

    const remaining = await countPendingBuyerEntities(client);
    console.log(`>>> Entity done: ${entity.name}  remaining=${remaining}`);
  }

  return { totalEntitiesDone, totalInserted, totalUpdated };
}

/**
 * Part worker for mainPartWise.sh:
 *   1. Query pending (listing_complete = false) buyer entities
 *   2. Take this part's slice
 *   3. Scrape batch → mark listing_complete
 *   4. Re-query & re-assign until global pending = 0, then stop
 */
async function runWorkerLoop({
  client,
  part,
  parts,
  years,
  cookieRef,
  delayMs,
  resync,
  order,
}) {
  if (!part || !parts) {
    throw new Error('--worker-loop requires --part K and --parts N');
  }
  if (part < 1 || part > parts) {
    throw new Error(`--part must be between 1 and ${parts}`);
  }

  let round = 0;
  let totalEntitiesDone = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  console.log('==============================================');
  console.log(` Buyer Entity Worker ${part}/${parts}`);
  console.log('==============================================');
  console.log(`Years : ${years.join(' ')}`);
  console.log(`Delay : ${delayMs > 0 ? `${delayMs / 1000}s per request` : 'off'}`);
  console.log('Mode  : re-query pending → scrape slice → repeat until all complete');
  console.log('==============================================\n');

  for (;;) {
    round += 1;
    const pendingTotal = await countPendingBuyerEntities(client);

    if (pendingTotal === 0) {
      console.log(`\nWorker ${part}/${parts}: all buyer entities complete — stopping`);
      console.log(`Rounds: ${round - 1}  entities_done: ${totalEntitiesDone}`);
      console.log(`Contracts insert=${totalInserted} update=${totalUpdated}`);
      console.log(`Finished: ${nowLabel()}`);
      break;
    }

    const pending = await loadPendingBuyerEntities(client);
    const batch = slicePart(pending, part, parts);

    console.log(
      `\n── Worker ${part}/${parts} round ${round} ── pending=${pendingTotal}  this_slice=${batch.length}`
    );

    if (!batch.length) {
      console.log(
        `   no entities in this part's slice — wait ${WORKER_IDLE_MS / 1000}s and re-count`
      );
      await sleep(WORKER_IDLE_MS);
      continue;
    }

    console.log(`   batch: ${batch.map((e) => e.name).slice(0, 3).join(' | ')}${batch.length > 3 ? ' | …' : ''}`);

    const stats = await runAutoYearWiseSequential({
      client,
      entities: batch,
      years,
      cookieRef,
      delayMs,
      resync,
      order,
      markComplete: true,
      workerLabel: `${part}/${parts}`,
    });

    totalEntitiesDone += batch.length;
    totalInserted += stats.totalInserted;
    totalUpdated += stats.totalUpdated;

    const remaining = await countPendingBuyerEntities(client);
    console.log(
      `   round ${round} done — scraped ${batch.length}  remaining=${remaining}  worker_total=${totalEntitiesDone}`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  const autoYearMode = shouldUseAutoYearMode(cli);
  const years = autoYearMode ? parseYearsArg(cli.years) : [];

  const fallbackYear = parseDDMMYYYY(END_DAY).getFullYear();
  const monthRange = cli.month ? parseMonthArg(cli.month, fallbackYear) : null;

  const startDay = cli.from || monthRange?.from || START_DAY;
  const endDay = cli.to || monthRange?.to || END_DAY;
  let startPage = Number(cli.page !== undefined ? cli.page : PAGE);
  if (Number.isNaN(startPage) || startPage < 0) startPage = 0;
  const delayMs = Math.round((cli.delaySec || 0) * 1000);
  const order = cli.order || 'down-to-top';

  if (!autoYearMode) {
    parseDDMMYYYY(startDay);
    parseDDMMYYYY(endDay);
    if (isAfter(startDay, endDay)) {
      throw new Error(`--from (${startDay}) must be on or before --to (${endDay})`);
    }
  }

  const pool = createPool();
  const cookieRef = { cookie: await getCookie() };

  try {
    const client = await pool.connect();
    try {
      let entities = await loadBuyerEntities(client);
      if (!entities.length) {
        throw new Error('No rows in buyer_entities table — run scrapeBuyerEntities.js first');
      }

      const wanted = (cli.entity || '').trim();

      if (autoYearMode && cli.workerLoop) {
        if (wanted) {
          throw new Error('--worker-loop cannot be used with --entity (runs all pending from DB)');
        }
        await runWorkerLoop({
          client,
          part: cli.part,
          parts: cli.parts,
          years,
          cookieRef,
          delayMs,
          resync: cli.resync,
          order,
        });
        return;
      }

      if (autoYearMode) {
        const priorityNames = parsePriorityEntitiesArg(cli.priorityEntities);

        if (wanted) {
          const one = entities.find((e) => e.name.toLowerCase() === wanted.toLowerCase());
          if (!one) {
            throw new Error(
              `Buyer entity "${wanted}" not found in buyer_entities table.\nAvailable e.g.: ${entities
                .slice(0, 5)
                .map((e) => e.name)
                .join(', ')}...`
            );
          }
          await runAutoYearWiseSequential({
            client,
            entities: [one],
            years,
            cookieRef,
            delayMs,
            resync: cli.resync,
            order,
            markComplete: true,
          });
          return;
        }

        await runAutoPendingSequentialLoop({
          client,
          years,
          priorityNames,
          cookieRef,
          delayMs,
          resync: cli.resync,
          order,
        });
        return;
      }

      if (wanted) {
        const one = entities.find((e) => e.name.toLowerCase() === wanted.toLowerCase());
        if (!one) {
          throw new Error(
            `Buyer entity "${wanted}" not found in buyer_entities table.\nAvailable e.g.: ${entities
              .slice(0, 5)
              .map((e) => e.name)
              .join(', ')}...`
          );
        }
        entities = [one];
      } else {
        if (cli.reverse) entities = [...entities].reverse();
        if (cli.part || cli.parts) {
          const before = entities.length;
          entities = slicePart(entities, cli.part, cli.parts);
          console.log(`part: ${cli.part}/${cli.parts}  (${entities.length} of ${before} entities)`);
        }
      }

      console.log(`entities: ${entities.length}${cli.reverse ? ' (reverse list)' : ''}`);
      if (entities.length) {
        console.log(`first: ${entities[0].name}`);
        console.log(`last: ${entities[entities.length - 1].name}`);
      }
      if (cli.month) console.log(`month: ${cli.month} → ${formatShort(startDay)} … ${formatShort(endDay)}`);
      const previewWindows = buildMonthWindows(startDay, endDay);
      const orderLabel =
        order === 'top-to-down' ? 'top-to-down (newest → oldest)' : 'down-to-top (oldest → newest)';
      console.log(
        `date scan: ${formatShort(startDay)} → ${formatShort(endDay)}  (${previewWindows.length} calendar months, ${orderLabel})`
      );
      if (previewWindows.length > 1) {
        const shown =
          order === 'top-to-down' ? [...previewWindows].reverse() : previewWindows;
        console.log(
          `month order: ${shown
            .slice(0, 3)
            .map((w) => formatShort(w.fromDate).replace(/^\d+-/, ''))
            .join(' → ')}${shown.length > 3 ? ' → …' : ''}`
        );
      }
      console.log(`delay: ${delayMs > 0 ? `${cli.delaySec}s per request` : 'off'}`);
      console.log(`resync: ${cli.resync ? 'yes' : 'no'}`);
      console.log(`store: buyer_entity_wise_contract_lists + pages + new_contracts(buyer_entity_id)\n`);

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        console.log(`\n======== [${i + 1}/${entities.length}] ${entity.name} ========`);

        const stats = await scanBuyerEntityWithRetry({
          client,
          entity,
          startDay,
          endDay,
          startPage,
          cookieRef,
          delayMs,
          resync: cli.resync,
          order,
        });
        console.log(
          `done: ${entity.name}  windows=${stats.savedCount}  empty=${stats.skippedEmpty}  done_windows=${stats.skippedDone}  resumed=${stats.resumedCount}  contracts_insert=${stats.insertedContracts}  contracts_update=${stats.updatedContracts}`
        );
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
