/**
 * Import ministry names from Names CSV into contract_ministry.
 *
 *   node src/gem/contract_ministry_add.js
 *   node src/gem/contract_ministry_add.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const NAMES_CSV = path.join(__dirname, 'Untitled spreadsheet - Names.csv');

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

function loadMinistryNames(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) throw new Error(`Empty CSV: ${filePath}`);

  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => /^name$/i.test(h));
  if (nameIdx < 0) throw new Error('Names CSV must have a Name column');

  const seen = new Set();
  const names = [];
  for (const cols of rows.slice(1)) {
    const name = (cols[nameIdx] || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const names = loadMinistryNames(NAMES_CSV);

  console.log(`csv: ${NAMES_CSV}`);
  console.log(`names: ${names.length}`);
  if (dryRun) {
    names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
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
      let skipped = 0;

      for (const name of names) {
        const result = await client.query(
          `INSERT INTO contract_ministry (name)
           VALUES ($1)
           ON CONFLICT (name) DO NOTHING
           RETURNING id`,
          [name]
        );
        if (result.rowCount > 0) inserted += 1;
        else skipped += 1;
      }

      await client.query('COMMIT');

      const { rows } = await client.query(
        'SELECT COUNT(*)::int AS total FROM contract_ministry'
      );

      console.log(`inserted: ${inserted}`);
      console.log(`skipped (already exists): ${skipped}`);
      console.log(`total in contract_ministry: ${rows[0].total}`);
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
