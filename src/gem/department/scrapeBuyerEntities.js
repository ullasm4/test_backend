/**
 * Scrape GeM "Name of Buyer Entity" autocomplete list from the contracts page
 * and store into buyer_entity_prefixes + buyer_entities.
 *
 * Processes prefixes in order: 1-char → 2-char → 3-char → 4-char combinations,
 * matching the frontend autocomplete filter (case-insensitive substring).
 *
 * Usage:
 *   node src/gem/department/scrapeBuyerEntities.js              # levels 1→2→3→4
 *   node src/gem/department/scrapeBuyerEntities.js --level 1    # single level only
 *   node src/gem/department/scrapeBuyerEntities.js --level 2 --part 1 --parts 10
 *   node src/gem/department/scrapeBuyerEntities.js --search dep
 *   node src/gem/department/scrapeBuyerEntities.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const axios = require('axios');
const { Client } = require('pg');

const LANDING = 'https://gem.gov.in/view_contracts';
const UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36';
const REQUEST_TIMEOUT_MS = 120000;
const ARRAY_MARKER = 'let serviceNamesRate = [';
const CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MIN_LEVEL = 1;
const MAX_LEVEL = 4;
const INSERT_BATCH_SIZE = 100000000;
const LEVEL_LABELS = {
  1: 'single character',
  2: 'double character',
  3: 'triple character',
  4: 'four character',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function printHelp() {
  console.log(`
GeM Buyer Entity Scraper

Usage:
  node src/gem/department/scrapeBuyerEntities.js [options]

Options:
  --level N       Run one level only (1–4). Default: all levels 1→2→3→4
  --part K        Partition slice to run (1 to N), use with --parts
  --parts N       Split prefixes at each level into N parts
  --search TEXT   Run a single search prefix only (overrides levels)
  --delay N       Delay in seconds between prefix batches (default: 0)
  --dry-run       Fetch and parse only; do not write to database
  --help          Show this help

Levels (default runs all in order):
  1 → single character   (a, b, c, …)           36 prefixes
  2 → double character   (aa, ab, ac, …)       1,296 prefixes
  3 → triple character   (aaa, aab, …)        46,656 prefixes
  4 → four character     (aaaa, aaab, …)   1,679,616 prefixes

Examples:
  node src/gem/department/scrapeBuyerEntities.js
  node src/gem/department/scrapeBuyerEntities.js --level 1
  node src/gem/department/scrapeBuyerEntities.js --level 2 --part 3 --parts 26
  bash scrapeBuyerEntities.sh
`);
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    help: false,
    level: 0,
    part: 0,
    parts: 0,
    search: '',
    delaySec: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--all-levels') {
      // kept for compatibility; default is already all levels
    }
    else if (a === '--level') out.level = Number(argv[++i] || 0);
    else if (a.startsWith('--level=')) out.level = Number(a.slice(8));
    else if (a === '--part') out.part = Number(argv[++i] || 0);
    else if (a.startsWith('--part=')) out.part = Number(a.slice(7));
    else if (a === '--parts') out.parts = Number(argv[++i] || 0);
    else if (a.startsWith('--parts=')) out.parts = Number(a.slice(8));
    else if (a === '--search') out.search = (argv[++i] || '').trim().toLowerCase();
    else if (a.startsWith('--search=')) out.search = a.slice(9).trim().toLowerCase();
    else if (a === '--delay') out.delaySec = Number(argv[++i] || 0);
    else if (/^--delay-(\d+)$/.test(a)) out.delaySec = Number(a.match(/^--delay-(\d+)$/)[1]);
    else if (a.startsWith('--delay=')) out.delaySec = Number(a.slice(8));
  }

  return out;
}

/** Same case-insensitive substring match used by jQuery UI autocomplete. */
function matchesAutocompleteFilter(name, term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return true;
  return String(name || '').toLowerCase().includes(q);
}

function charsetSize() {
  return CHARSET.length;
}

function prefixCount(length) {
  if (length <= 0) return 0;
  return charsetSize() ** length;
}

/** Build the Nth prefix of a given length without materializing the full list. */
function prefixAt(length, index) {
  const chars = new Array(length);
  let idx = index;
  for (let pos = length - 1; pos >= 0; pos--) {
    chars[pos] = CHARSET[idx % charsetSize()];
    idx = Math.floor(idx / charsetSize());
  }
  return chars.join('');
}

function partitionRange(total, part, parts) {
  if (!part || !parts || parts <= 1) {
    return { start: 0, end: total };
  }
  if (part < 1 || part > parts) {
    throw new Error(`--part must be between 1 and ${parts} (got ${part})`);
  }
  const size = Math.ceil(total / parts);
  const start = (part - 1) * size;
  const end = Math.min(start + size, total);
  return { start, end };
}

function resolveLevels(cli) {
  if (cli.search) return [];
  if (cli.level > 0) {
    if (cli.level < MIN_LEVEL || cli.level > MAX_LEVEL) {
      throw new Error(`--level must be between ${MIN_LEVEL} and ${MAX_LEVEL}`);
    }
    return [cli.level];
  }
  return [1, 2, 3, 4];
}

function levelLabel(level) {
  return LEVEL_LABELS[level] || `level ${level}`;
}

function resolveSearchPlan(cli) {
  if (cli.search) {
    return [{ kind: 'single', terms: [cli.search] }];
  }

  return resolveLevels(cli).map((level) => {
    const total = prefixCount(level);
    const { start, end } = partitionRange(total, cli.part, cli.parts);
    return { kind: 'level', level, start, end, total };
  });
}

function* iterateSearchTerms(plan) {
  for (const chunk of plan) {
    if (chunk.kind === 'single') {
      for (const term of chunk.terms) yield term;
      continue;
    }

    for (let i = chunk.start; i < chunk.end; i++) {
      yield prefixAt(chunk.level, i);
    }
  }
}

function countSearchTerms(plan) {
  let total = 0;
  for (const chunk of plan) {
    if (chunk.kind === 'single') total += chunk.terms.length;
    else total += chunk.end - chunk.start;
  }
  return total;
}

function buildAssignments(nameIndex, termList, knownNames = new Set()) {
  return assignNamesToPrefixes(nameIndex, termList, knownNames);
}

function extractServiceNamesRateArray(html) {
  const start = html.indexOf(ARRAY_MARKER);
  if (start < 0) {
    throw new Error('serviceNamesRate array not found on GeM contracts page');
  }

  const arrayStart = start + ARRAY_MARKER.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart; i < html.length; i++) {
    const ch = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const arrayLiteral = html.slice(arrayStart, i + 1);
        let parsed;
        try {
          parsed = JSON.parse(arrayLiteral);
        } catch {
          throw new Error('Failed to parse serviceNamesRate JSON array from GeM page');
        }
        if (!Array.isArray(parsed)) {
          throw new Error('serviceNamesRate is not an array');
        }
        return parsed;
      }
    }
  }

  throw new Error('Unterminated serviceNamesRate array in GeM page HTML');
}

async function fetchBuyerEntityNames() {
  const res = await axios.get(LANDING, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (res.status !== 200 || typeof res.data !== 'string') {
    throw new Error(`GeM page fetch failed (HTTP ${res.status})`);
  }

  return extractServiceNamesRateArray(res.data)
    .map(decodeHtmlEntities)
    .map((name) => String(name || '').trim())
    .filter(Boolean);
}

function buildNameIndex(allNames) {
  return allNames.map((name) => ({ name, lower: name.toLowerCase() }));
}

function countAutocompleteMatches(nameIndex, term) {
  const q = term.toLowerCase();
  let count = 0;
  for (const row of nameIndex) {
    if (row.lower.includes(q)) count += 1;
  }
  return count;
}

/** Assign each unstored name to the first matching prefix (same order as frontend search). */
function assignNamesToPrefixes(nameIndex, searchTerms, knownNames = new Set()) {
  const assigned = new Set(knownNames);
  const rows = [];

  for (const { term, level } of searchTerms) {
    const q = term.toLowerCase();
    const matches = [];

    for (const row of nameIndex) {
      if (assigned.has(row.lower)) continue;
      if (row.lower.includes(q)) {
        matches.push(row.name);
        assigned.add(row.lower);
      }
    }

    rows.push({ term, level, matches });
  }

  return rows;
}

function flattenSearchTerms(plan) {
  const terms = [];
  for (const chunk of plan) {
    if (chunk.kind === 'single') {
      for (const term of chunk.terms) {
        terms.push({ term, level: term.length });
      }
      continue;
    }

    for (let i = chunk.start; i < chunk.end; i++) {
      const term = prefixAt(chunk.level, i);
      terms.push({ term, level: chunk.level });
    }
  }
  return terms;
}

function logLevelSection(chunk) {
  if (chunk.kind !== 'level') return;
  console.log('');
  console.log(`=== level ${chunk.level}: ${levelLabel(chunk.level)} (${chunk.end - chunk.start} prefix(es)) ===`);
  console.log(`    range ${chunk.start + 1}-${chunk.end} of ${chunk.total}`);
}

async function upsertPrefix(client, prefix, level) {
  const result = await client.query(
    `INSERT INTO buyer_entity_prefixes (prefix, level, total_entities)
     VALUES ($1, $2, 0)
     ON CONFLICT (prefix) DO UPDATE
       SET level = EXCLUDED.level,
           updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [prefix, level]
  );
  return result.rows[0].id;
}

async function syncPrefixTotal(client, prefixId) {
  await client.query(
    `UPDATE buyer_entity_prefixes
     SET total_entities = (
       SELECT COUNT(*)::int FROM buyer_entities WHERE prefix_id = $1
     ),
     updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [prefixId]
  );
}

async function syncPrefixTotals(client, prefixes) {
  if (!prefixes.length) return;

  await client.query(
    `UPDATE buyer_entity_prefixes p
     SET total_entities = COALESCE(sub.cnt, 0),
         updated_at = CURRENT_TIMESTAMP
     FROM (
       SELECT prefix_id, COUNT(*)::int AS cnt
       FROM buyer_entities
       GROUP BY prefix_id
     ) sub
     WHERE p.id = sub.prefix_id
       AND p.prefix = ANY($1::text[])`,
    [prefixes]
  );
}

function createDbClient() {
  return new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function loadKnownNames(client) {
  const { rows } = await client.query('SELECT lower(name) AS key FROM buyer_entities');
  return new Set(rows.map((row) => row.key));
}

async function batchInsertEntities(client, prefixId, names) {
  if (!names.length) return 0;

  let inserted = 0;
  for (let i = 0; i < names.length; i += INSERT_BATCH_SIZE) {
    const batch = names.slice(i, i + INSERT_BATCH_SIZE);
    const result = await client.query(
      `INSERT INTO buyer_entities (name, prefix_id)
       SELECT v.name, $1
       FROM unnest($2::text[]) AS v(name)
       ON CONFLICT (name) DO NOTHING`,
      [prefixId, batch]
    );
    inserted += result.rowCount;
  }

  return inserted;
}

async function processPrefixBatch(client, {
  nameIndex,
  assignments,
  knownNames,
  dryRun,
  delayMs,
  levelPrefix,
}) {
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalAssigned = 0;
  let totalAutocomplete = 0;
  const processedPrefixes = [];

  for (let i = 0; i < assignments.length; i++) {
    const row = assignments[i];
    const autocomplete = countAutocompleteMatches(nameIndex, row.term);
    totalAutocomplete += autocomplete;
    totalAssigned += row.matches.length;
    processedPrefixes.push(row.term);

    if (dryRun) {
      console.log(
        `  [${row.term}] level=${row.level} autocomplete=${autocomplete} assign=${row.matches.length}`
      );
      row.matches.slice(0, 3).forEach((name) => console.log(`    - ${name}`));
      if (row.matches.length > 3) console.log(`    ... +${row.matches.length - 3} more`);
      if (delayMs > 0 && i < assignments.length - 1) await sleep(delayMs);
      continue;
    }

    await client.query('BEGIN');

    try {
      const prefixId = await upsertPrefix(client, row.term, row.level);
      const inserted = await batchInsertEntities(client, prefixId, row.matches);
      await syncPrefixTotal(client, prefixId);
      await client.query('COMMIT');

      totalInserted += inserted;
      totalSkipped += row.matches.length - inserted;

      for (const name of row.matches) {
        knownNames.add(name.toLowerCase());
      }

      const stored = await client.query(
        'SELECT total_entities::int AS total FROM buyer_entity_prefixes WHERE id = $1',
        [prefixId]
      );

      console.log(
        `${levelPrefix}[${i + 1}/${assignments.length}] "${row.term}" level=${row.level} autocomplete=${autocomplete} assign=${row.matches.length} inserted=${inserted} stored=${stored.rows[0].total}`
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    if (delayMs > 0 && i < assignments.length - 1) await sleep(delayMs);
  }

  if (!dryRun && processedPrefixes.length) {
    await syncPrefixTotals(client, processedPrefixes);
  }

  return {
    totalInserted,
    totalSkipped,
    totalAssigned,
    totalAutocomplete,
    prefixCount: assignments.length,
  };
}

async function processSearchTerms(allNames, searchPlan, { dryRun, delayMs }) {
  if (!searchPlan.length) {
    throw new Error('No search prefixes to process');
  }

  const nameIndex = buildNameIndex(allNames);
  let knownNames = new Set();
  let client = null;

  if (!dryRun) {
    client = createDbClient();
    await client.connect();
    knownNames = await loadKnownNames(client);
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalAssigned = 0;
  let totalAutocomplete = 0;
  let totalPrefixes = 0;

  try {
    for (const chunk of searchPlan) {
      logLevelSection(chunk);
      const termList = flattenSearchTerms([chunk]);
      const assignments = buildAssignments(nameIndex, termList, knownNames);
      const stats = await processPrefixBatch(client, {
        nameIndex,
        assignments,
        knownNames,
        dryRun,
        delayMs,
        levelPrefix: chunk.kind === 'level' ? '  ' : '',
      });

      totalInserted += stats.totalInserted;
      totalSkipped += stats.totalSkipped;
      totalAssigned += stats.totalAssigned;
      totalAutocomplete += stats.totalAutocomplete;
      totalPrefixes += stats.prefixCount;
    }

    if (dryRun) {
      console.log('');
      console.log(
        `dry-run — prefixes=${totalPrefixes} autocomplete=${totalAutocomplete} assign=${totalAssigned} (nothing inserted)`
      );
      return;
    }

    const { rows } = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM buyer_entities) AS entities,
        (SELECT COUNT(*)::int FROM buyer_entity_prefixes) AS prefixes,
        (SELECT COALESCE(SUM(total_entities), 0)::int FROM buyer_entity_prefixes) AS prefix_entity_total
    `);

    console.log('');
    console.log(
      `done — prefixes=${totalPrefixes} inserted=${totalInserted} skipped=${totalSkipped} assign=${totalAssigned} autocomplete=${totalAutocomplete}`
    );
    console.log(`total buyer_entities: ${rows[0].entities}`);
    console.log(`total buyer_entity_prefixes: ${rows[0].prefixes}`);
    console.log(`sum buyer_entity_prefixes.total_entities: ${rows[0].prefix_entity_total}`);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

async function runScrape(cli) {
  const searchPlan = resolveSearchPlan(cli);
  const termTotal = countSearchTerms(searchPlan);
  if (!termTotal) {
    throw new Error('No search prefixes to process');
  }

  console.log(`fetch: ${LANDING}`);
  const allNames = await fetchBuyerEntityNames();
  console.log(`parsed from page: ${allNames.length}`);

  if (cli.search) {
    console.log(`mode: single search "${cli.search}"`);
  } else if (cli.level > 0) {
    console.log(`mode: level ${cli.level} only — ${levelLabel(cli.level)} (${termTotal} prefix(es))`);
  } else {
    console.log('mode: all levels 1→2→3→4 (single → double → triple → four character)');
    console.log(`  total prefixes: ${termTotal}`);
  }

  if (cli.part && cli.parts) {
    console.log(`partition: part ${cli.part}/${cli.parts}`);
  }

  const delayMs = Math.max(0, cli.delaySec) * 1000;
  await processSearchTerms(allNames, searchPlan, { dryRun: cli.dryRun, delayMs });
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }

  await runScrape(cli);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
