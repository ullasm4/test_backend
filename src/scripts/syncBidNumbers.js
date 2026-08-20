/**
 * Sync bid_number from contract_management_1 (DB1) → contract_management (DB2)
 *
 * - Reads all rows with a non-null bid_number from DB1.contracts
 * - Matches by contract_number in DB2.new_contracts
 * - Updates bid_number in DB2
 *
 * Usage:
 *   node src/scripts/syncBidNumbers.js
 *   node src/scripts/syncBidNumbers.js --dry-run
 *   node src/scripts/syncBidNumbers.js --batch=500
 *   node src/scripts/syncBidNumbers.js --only-missing   (skip rows that already have a bid_number in DB2)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { Pool } = require('pg');

const BATCH_SIZE = parseInt(
  process.argv.find((a) => a.startsWith('--batch='))?.split('=')[1] || '1000',
  10,
);
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_MISSING = process.argv.includes('--only-missing');

// Source: contract_management_1 (bid_number originates here)
function createSourcePool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL_2,
    ssl: process.env.DB_SSL_2 === 'true' ? { rejectUnauthorized: false } : false,
  });
}

// Target: contract_management (bid_number gets written here)
function createTargetPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function run() {
  const source = createSourcePool();
  const target = createTargetPool();

  try {
    const { rows: countRows } = await source.query(
      `SELECT count(*) AS cnt FROM contracts WHERE bid_number IS NOT NULL AND bid_number != ''`,
    );
    const totalSource = parseInt(countRows[0].cnt, 10);
    console.log(`[source] Found ${totalSource} contracts with bid_number in contract_management_1.contracts`);

    if (totalSource === 0) {
      console.log('Nothing to sync — exiting.');
      return;
    }

    if (DRY_RUN) console.log('[mode] Dry run — no writes will be made.');
    if (ONLY_MISSING) console.log('[mode] Only filling rows where target bid_number is currently empty.');

    let offset = 0;
    let updated = 0;

    while (offset < totalSource) {
      const { rows: batch } = await source.query(
        `SELECT contract_number, bid_number
         FROM contracts
         WHERE bid_number IS NOT NULL AND bid_number != ''
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, offset],
      );

      if (batch.length === 0) break;

      const contractNumbers = batch.map((r) => r.contract_number);
      const bidNumbers = batch.map((r) => r.bid_number);

      if (DRY_RUN) {
        console.log(`[dry-run] Would update ${batch.length} rows (offset ${offset})`);
        updated += batch.length;
      } else {
        const onlyMissingClause = ONLY_MISSING
          ? `AND (nc.bid_number IS NULL OR nc.bid_number = '')`
          : '';

        const result = await target.query(
          `UPDATE new_contracts nc
           SET bid_number = bulk.bid_number, buying_mode = 'Bid/RA'
           FROM unnest($1::text[], $2::text[]) AS bulk(contract_number, bid_number)
           WHERE nc.contract_number = bulk.contract_number ${onlyMissingClause}`,
          [contractNumbers, bidNumbers],
        );

        updated += result.rowCount;
      }

      offset += batch.length;
      console.log(`[progress] Processed ${offset}/${totalSource} — updated: ${updated}`);
    }

    console.log(`\n[done] Total updated: ${updated}`);
  } catch (err) {
    console.error('[fatal error]', err.message);
    process.exit(1);
  } finally {
    await source.end();
    await target.end();
  }
}

run();