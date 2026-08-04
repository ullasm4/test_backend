/**
 * Import contracts-results.csv rows into contract_lists.
 *
 *   node src/gem/contract_lists_add.js
 *   node src/gem/contract_lists_add.js --dry-run
 *   node src/gem/contract_lists_add.js --name "Autonomous Body"
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const RESULTS_CSV = path.join(__dirname, 'contracts-results.csv');

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
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** "19-6-2026 to 17-9-2026" → { fromDate: '2026-06-19', toDate: '2026-09-17' } */
function parseDateRange(label) {
  const m = String(label)
    .trim()
    .match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+to\s+(\d{1,2})-(\d{1,2})-(\d{4})$/i);
  if (!m) throw new Error(`Bad date range: ${label}`);

  const pad = (n) => String(n).padStart(2, '0');
  return {
    fromDate: `${m[3]}-${pad(m[2])}-${pad(m[1])}`,
    toDate: `${m[6]}-${pad(m[5])}-${pad(m[4])}`,
  };
}

function loadResults(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`Empty CSV: ${filePath}`);

  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => /^name$/i.test(h));
  const dateIdx = header.findIndex((h) => /^date$/i.test(h));
  const pagesIdx = header.findIndex((h) => /^pages?$/i.test(h));
  if (nameIdx < 0 || dateIdx < 0) {
    throw new Error('CSV must have Name and date columns');
  }

  const out = [];
  const seen = new Set();

  for (const cols of rows.slice(1)) {
    const name = (cols[nameIdx] || '').trim();
    const dateLabel = (cols[dateIdx] || '').trim();
    if (!name || !dateLabel) continue;

    const { fromDate, toDate } = parseDateRange(dateLabel);
    const pages = Math.max(0, Number(pagesIdx >= 0 ? cols[pagesIdx] : 0) || 0);
    const key = `${name.toLowerCase()}|${fromDate}|${toDate}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, fromDate, toDate, pages, dateLabel });
  }

  return out;
}

function parseArgs(argv) {
  const out = { dryRun: false, name: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--name') out.name = argv[++i] ?? '';
    else if (a.startsWith('--name=')) out.name = a.slice(7);
  }
  return out;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  let rows = loadResults(RESULTS_CSV);

  if (cli.name.trim()) {
    const wanted = cli.name.trim().toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase() === wanted);
    if (!rows.length) throw new Error(`No CSV rows for ministry "${cli.name}"`);
  }

  console.log(`csv: ${RESULTS_CSV}`);
  console.log(`rows: ${rows.length}`);

  if (cli.dryRun) {
    rows.slice(0, 10).forEach((r, i) => {
      console.log(
        `  ${i + 1}. ${r.name} | ${r.fromDate} → ${r.toDate} | pages=${r.pages}`
      );
    });
    if (rows.length > 10) console.log(`  ... +${rows.length - 10} more`);
    console.log('dry-run — nothing inserted');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      for (const row of rows) {
        const result = await client.query(
          `INSERT INTO contract_lists (name, from_date, to_date, pages, total_contracts, is_scrapped)
           VALUES ($1, $2::date, $3::date, $4, 0, FALSE)
           ON CONFLICT (name, from_date, to_date) DO UPDATE SET
             pages = EXCLUDED.pages,
             updated_at = CURRENT_TIMESTAMP
           WHERE contract_lists.pages IS DISTINCT FROM EXCLUDED.pages
           RETURNING (xmax = 0) AS is_insert`,
          [row.name, row.fromDate, row.toDate, row.pages]
        );

        if (result.rowCount === 0) {
          skipped += 1;
        } else if (result.rows[0].is_insert) {
          inserted += 1;
        } else {
          updated += 1;
        }
      }

      await client.query('COMMIT');

      const { rows: countRows } = await client.query(
        'SELECT COUNT(*)::int AS total FROM contract_lists'
      );

      console.log(`inserted: ${inserted}`);
      console.log(`updated: ${updated}`);
      console.log(`unchanged: ${skipped}`);
      console.log(`total in contract_lists: ${countRows[0].total}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
