/**
 * Fast backfill of city_id from address.
 * 1) Match against existing cities (longest name wins)
 * 2) If no match, extract city from address; if missing in cities, INSERT it
 * 3) Set city_id on seller/buyer rows
 *
 * Requires:
 *   20260907100505_insert_states_and_cities.sql
 *   20260907170000_replace_city_text_with_city_id.sql
 *
 * Usage:
 *   npm run backfill:city
 *   node src/scripts/backfillCityFromAddress.js --dry-run
 *   node src/scripts/backfillCityFromAddress.js --samples
 *   node src/scripts/backfillCityFromAddress.js --table=seller
 *   node src/scripts/backfillCityFromAddress.js --table=buyer
 *   node src/scripts/backfillCityFromAddress.js --force
 */

require('module-alias/register');
require('@/config/env');

const { Pool } = require('pg');
const env = require('@/config/env');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const SAMPLES_ONLY = args.includes('--samples');

function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  return fallback;
}

const TABLE = String(getArg('--table', 'all') || 'all').toLowerCase();
const BATCH_SIZE = 10000;

const ALIASES = [
  [/bangalore/gi, 'bengaluru'],
  [/bombay/gi, 'mumbai'],
  [/madras/gi, 'chennai'],
  [/calcutta/gi, 'kolkata'],
  [/gurugram/gi, 'gurgaon'],
  [/trivandrum/gi, 'thiruvananthapuram'],
];

const GST_STATE_CODE_TO_NAME = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

const INVALID_CITY_RE =
  /\b(road|street|nagar|sector|plot|floor|building|complex|near|opp|opposite|village|taluk|dist|district|post|office|india|limited|ltd|pvt|private|company|block|phase|area|layout|cross|main|gate|ward|colony|extension|extn|apartment|tower|house|no|number)\b/i;

const TARGETS = {
  seller: {
    label: 'sellers',
    table: 'new_seller_information',
    idCol: 'id',
  },
  buyer: {
    label: 'buyers',
    table: 'new_buyer_details',
    idCol: 'id',
  },
};

function createPool() {
  if (env.DATABASE_URL) {
    return new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
      max: 2,
    });
  }
  return new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
    max: 2,
  });
}

function normalizeForCity(text) {
  let s = String(text || '');
  for (const [from, to] of ALIASES) {
    s = s.replace(from, to);
  }
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseCity(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function isValidCityName(name) {
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 80) return false;
  if (!/^[A-Za-z]/.test(n)) return false;
  if (!/[A-Za-z]{2,}/.test(n)) return false;
  if (/\d{4,}/.test(n)) return false;
  if (INVALID_CITY_RE.test(n)) return false;
  const words = n.split(/\s+/);
  if (words.length > 4) return false;
  return true;
}

function matchExistingCity(address, citiesSorted) {
  const cleaned = ` ${normalizeForCity(address)} `;
  if (cleaned === '  ') return null;
  for (const city of citiesSorted) {
    if (cleaned.includes(city.needle)) return city;
  }
  return null;
}

/** Extract city (+ optional state hint) from free-text address when not in cities table. */
function extractCityFromAddress(address, statesSorted) {
  let text = String(address || '')
    .replace(/[\n\r|;]+/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;

  // Apply aliases on text for better city token
  for (const [from, to] of ALIASES) {
    text = text.replace(from, to);
  }

  // Pattern: City, STATE-PINCODE  (most GeM addresses)
  let m = text.match(
    /,\s*([A-Za-z][A-Za-z .']{1,60}?)\s*,\s*([A-Za-z][A-Za-z .&()]{2,45}?)\s*[-–]\s*(\d{6})\b/
  );
  if (m && isValidCityName(m[1])) {
    return { cityName: titleCaseCity(m[1]), stateHint: m[2].trim() };
  }

  // Pattern: City STATE-PINCODE (fewer commas)
  m = text.match(
    /([A-Za-z][A-Za-z .']{1,60}?)\s+([A-Za-z][A-Za-z .&()]{2,45}?)\s*[-–]\s*(\d{6})\b/
  );
  if (m && isValidCityName(m[1])) {
    return { cityName: titleCaseCity(m[1]), stateHint: m[2].trim() };
  }

  // Pattern: find known state near end, take previous token as city
  const cleaned = ` ${normalizeForCity(text)} `;
  for (const st of statesSorted) {
    const idx = cleaned.lastIndexOf(st.needle);
    if (idx < 0) continue;
    const before = cleaned.slice(0, idx).trim();
    const parts = before.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;

    // try 1–3 word city before state
    for (let w = Math.min(3, parts.length); w >= 1; w -= 1) {
      const candidate = titleCaseCity(parts.slice(-w).join(' '));
      if (isValidCityName(candidate)) {
        return { cityName: candidate, stateHint: st.name };
      }
    }
  }

  return null;
}

function resolveStateId(gstNumber, stateHint, statesByGst, statesByNorm) {
  const gst = String(gstNumber || '').trim();
  if (gst.length >= 2) {
    const code = gst.slice(0, 2);
    if (statesByGst.has(code)) return statesByGst.get(code);
  }

  if (stateHint) {
    const norm = normalizeForCity(stateHint);
    if (statesByNorm.has(norm)) return statesByNorm.get(norm);
    // partial: "KARNATAKA" vs "Karnataka"
    for (const [key, id] of statesByNorm.entries()) {
      if (key.includes(norm) || norm.includes(key)) return id;
    }
  }

  return null;
}

function addCityToMemory(citiesSorted, city) {
  const norm = normalizeForCity(city.name);
  if (!norm) return citiesSorted;
  const entry = {
    id: city.id,
    name: city.name,
    stateId: city.state_id || city.stateId || null,
    needle: ` ${norm} `,
    len: norm.length,
  };
  const next = citiesSorted.filter((c) => c.id !== entry.id);
  next.push(entry);
  next.sort((a, b) => b.len - a.len || a.name.localeCompare(b.name));
  return next;
}

async function ensureReady(client) {
  const cities = await client.query(`SELECT to_regclass('public.cities') AS cities`);
  if (!cities.rows[0]?.cities) {
    throw new Error('Missing public.cities. Run: npx dbmate up');
  }

  const col = await client.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'new_seller_information'
       AND column_name = 'city_id'
     LIMIT 1`
  );
  if (!col.rows[0]) {
    throw new Error('Missing city_id column. Run: npx dbmate up');
  }
}

async function loadStates(client) {
  const { rows } = await client.query(
    `SELECT id, name, gst_code FROM states WHERE name IS NOT NULL`
  );

  const statesByGst = new Map();
  const statesByNorm = new Map();
  const statesSorted = [];

  for (const r of rows) {
    const norm = normalizeForCity(r.name);
    if (norm) statesByNorm.set(norm, r.id);
    if (r.gst_code) statesByGst.set(String(r.gst_code).padStart(2, '0'), r.id);

    // also map GST name aliases from static map when gst_code present
    statesSorted.push({
      id: r.id,
      name: r.name,
      needle: ` ${norm} `,
      len: norm.length,
    });
  }

  // Fill gst map from static names if gst_code missing on some rows
  for (const [code, name] of Object.entries(GST_STATE_CODE_TO_NAME)) {
    if (statesByGst.has(code)) continue;
    const id = statesByNorm.get(normalizeForCity(name));
    if (id) statesByGst.set(code, id);
  }

  statesSorted.sort((a, b) => b.len - a.len || a.name.localeCompare(b.name));
  console.log(`Loaded ${rows.length.toLocaleString()} states`);
  return { statesByGst, statesByNorm, statesSorted };
}

async function loadCities(client) {
  const { rows } = await client.query(`SELECT id, name, state_id FROM cities`);
  const cities = rows
    .map((r) => {
      const norm = normalizeForCity(r.name);
      if (!norm) return null;
      return {
        id: r.id,
        name: r.name,
        stateId: r.state_id,
        needle: ` ${norm} `,
        len: norm.length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.len - a.len || a.name.localeCompare(b.name));

  console.log(`Loaded ${cities.length.toLocaleString()} cities`);
  return cities;
}

async function findOrCreateCity(client, citiesRef, cache, cityName, stateId) {
  const key = `${normalizeForCity(cityName)}|${stateId}`;
  if (cache.has(key)) return cache.get(key);

  const existing = await client.query(
    `SELECT id, name, state_id
     FROM cities
     WHERE state_id = $1
       AND lower(btrim(name)) = lower(btrim($2))
     LIMIT 1`,
    [stateId, cityName]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    cache.set(key, row.id);
    citiesRef.list = addCityToMemory(citiesRef.list, row);
    return row.id;
  }

  if (DRY_RUN) {
    return null;
  }

  const inserted = await client.query(
    `INSERT INTO cities (name, state_id)
     VALUES ($1, $2)
     ON CONFLICT (name, state_id) DO UPDATE
       SET updated_at = CURRENT_TIMESTAMP
     RETURNING id, name, state_id`,
    [cityName, stateId]
  );

  // Unique index is on (name, state_id) exact — if conflict by case, fetch again
  let row = inserted.rows[0];
  if (!row) {
    const again = await client.query(
      `SELECT id, name, state_id
       FROM cities
       WHERE state_id = $1 AND lower(btrim(name)) = lower(btrim($2))
       LIMIT 1`,
      [stateId, cityName]
    );
    row = again.rows[0];
  }
  if (!row) return null;

  cache.set(key, row.id);
  citiesRef.list = addCityToMemory(citiesRef.list, row);
  return row.id;
}

async function countPending(client, table) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM ${table}
     WHERE ${FORCE ? 'TRUE' : 'city_id IS NULL'}
       AND address IS NOT NULL
       AND BTRIM(address) <> ''`
  );
  return rows[0]?.total || 0;
}

async function resolveCityId(client, row, citiesRef, states, cache, stats) {
  const existing = matchExistingCity(row.address, citiesRef.list);
  if (existing) {
    stats.matchedExisting += 1;
    return existing.id;
  }

  const extracted = extractCityFromAddress(row.address, states.statesSorted);
  if (!extracted) {
    stats.unparseable += 1;
    return null;
  }

  const stateId = resolveStateId(row.gst_number, extracted.stateHint, states.statesByGst, states.statesByNorm);
  if (!stateId) {
    stats.noState += 1;
    return null;
  }

  // Prefer an existing city with same name in any state if GST state mismatch
  const anyExisting = citiesRef.list.find(
    (c) => normalizeForCity(c.name) === normalizeForCity(extracted.cityName)
  );
  if (anyExisting && anyExisting.stateId === stateId) {
    stats.matchedExisting += 1;
    return anyExisting.id;
  }

  const cityId = await findOrCreateCity(client, citiesRef, cache, extracted.cityName, stateId);
  if (cityId) {
    stats.createdOrLinked += 1;
    return cityId;
  }
  stats.unparseable += 1;
  return null;
}

async function printSamples(client, target, citiesRef, states, limit = 10) {
  const { rows } = await client.query(
    `SELECT t.address, t.gst_number
     FROM ${target.table} t
     WHERE t.address IS NOT NULL AND BTRIM(t.address) <> ''
       AND ${FORCE ? 'TRUE' : 't.city_id IS NULL'}
     ORDER BY random()
     LIMIT $1`,
    [limit]
  );
  console.log(`\n${target.label} samples:`);
  for (const row of rows) {
    const existing = matchExistingCity(row.address, citiesRef.list);
    let label = existing?.name || null;
    let note = existing ? 'existing' : '';
    if (!existing) {
      const extracted = extractCityFromAddress(row.address, states.statesSorted);
      const stateId = extracted
        ? resolveStateId(row.gst_number, extracted.stateHint, states.statesByGst, states.statesByNorm)
        : null;
      if (extracted && stateId) {
        label = extracted.cityName;
        note = 'will create/link';
      } else if (extracted) {
        label = extracted.cityName;
        note = 'no state';
      } else {
        note = 'no match';
      }
    }
    const preview = String(row.address || '').replace(/\s+/g, ' ').slice(0, 110);
    console.log(`  ${label || '(none)'} [${note}]  |  ${preview}`);
  }
}

async function backfillTable(client, target, citiesRef, states) {
  const pending = await countPending(client, target.table);
  console.log(`\n${target.label}: ${pending.toLocaleString()} rows to process`);

  const cache = new Map();
  const stats = {
    matchedExisting: 0,
    createdOrLinked: 0,
    noState: 0,
    unparseable: 0,
  };

  if (SAMPLES_ONLY) {
    if (pending > 0) await printSamples(client, target, citiesRef, states);
    return { updated: 0, created: 0 };
  }

  if (pending === 0) {
    console.log(`${target.label}: nothing to update`);
    return { updated: 0, created: 0 };
  }

  if (DRY_RUN) {
    await printSamples(client, target, citiesRef, states, 8);
    return { updated: 0, created: 0 };
  }

  let updated = 0;
  let scanned = 0;
  let createdBefore = 0;
  let lastId = null;
  const started = Date.now();
  const citiesBefore = citiesRef.list.length;

  while (true) {
    const params = [BATCH_SIZE];
    let idCursorSql = '';
    if (lastId) {
      params.push(lastId);
      idCursorSql = `AND s.${target.idCol} > $${params.length}`;
    }

    const { rows } = await client.query(
      `SELECT s.${target.idCol} AS id, s.address, s.gst_number
       FROM ${target.table} s
       WHERE ${FORCE ? 'TRUE' : 's.city_id IS NULL'}
         AND s.address IS NOT NULL
         AND BTRIM(s.address) <> ''
         ${idCursorSql}
       ORDER BY s.${target.idCol}
       LIMIT $1`,
      params
    );

    if (!rows.length) break;

    const ids = [];
    const cityIds = [];
    for (const row of rows) {
      scanned += 1;
      const cityId = await resolveCityId(client, row, citiesRef, states, cache, stats);
      if (!cityId) continue;
      ids.push(row.id);
      cityIds.push(cityId);
    }

    if (ids.length) {
      const upd = await client.query(
        `UPDATE ${target.table} t
         SET city_id = v.city_id
         FROM (
           SELECT UNNEST($1::uuid[]) AS id, UNNEST($2::uuid[]) AS city_id
         ) v
         WHERE t.${target.idCol} = v.id
           AND (t.city_id IS DISTINCT FROM v.city_id)`,
        [ids, cityIds]
      );
      updated += upd.rowCount || 0;
    }

    lastId = rows[rows.length - 1].id;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const rate = Math.round(scanned / Math.max(0.001, (Date.now() - started) / 1000));
    const createdNow = citiesRef.list.length - citiesBefore;
    console.log(
      `${target.label}: ${scanned.toLocaleString()}/${pending.toLocaleString()} scanned, ${updated.toLocaleString()} updated, ${createdNow.toLocaleString()} cities added (${rate}/s, ${elapsed}s)`
    );
    createdBefore = createdNow;

    if (rows.length < BATCH_SIZE) break;
  }

  const created = citiesRef.list.length - citiesBefore;
  console.log(
    `${target.label}: done — updated=${updated.toLocaleString()}, existing_matches=${stats.matchedExisting.toLocaleString()}, new_city_links=${stats.createdOrLinked.toLocaleString()}, cities_added≈${created.toLocaleString()}, no_state=${stats.noState.toLocaleString()}, unmatched=${stats.unparseable.toLocaleString()}`
  );
  return { updated, created };
}

async function main() {
  if (!['all', 'seller', 'buyer'].includes(TABLE)) {
    throw new Error(`Invalid --table=${TABLE}. Use all | seller | buyer`);
  }

  const pool = createPool();
  const client = await pool.connect();

  try {
    console.log(
      `City backfill started (table=${TABLE}${FORCE ? ', force' : ''}${DRY_RUN ? ', dry-run' : ''}${SAMPLES_ONLY ? ', samples' : ''})`
    );
    await ensureReady(client);
    const states = await loadStates(client);
    const citiesRef = { list: await loadCities(client) };

    const selected =
      TABLE === 'all' ? [TARGETS.seller, TARGETS.buyer] : [TARGETS[TABLE]];

    let totalUpdated = 0;
    let totalCreated = 0;
    for (const target of selected) {
      const result = await backfillTable(client, target, citiesRef, states);
      totalUpdated += result.updated;
      totalCreated += result.created;
    }

    console.log(
      `\nDone. Updated ${totalUpdated.toLocaleString()} rows, cities added ≈ ${totalCreated.toLocaleString()}${DRY_RUN || SAMPLES_ONLY ? ' (no writes)' : ''}`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
