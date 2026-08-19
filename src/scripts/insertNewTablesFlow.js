/**
 * Backfill unique seller / buyer / contract rows into the new tables.
 *
 * Requires migration 20260819100000_sync_new_tables_flow_triggers.sql.
 *
 *   node src/scripts/insertNewTablesFlow.js
 *   node src/scripts/insertNewTablesFlow.js --dry-run
 *   node src/scripts/insertNewTablesFlow.js --fresh
 *   node src/scripts/insertNewTablesFlow.js --counts-only
 */

require('module-alias/register');
require('@/config/env');

const { Pool } = require('pg');
const env = require('@/config/env');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FRESH = args.includes('--fresh');
const COUNTS_ONLY = args.includes('--counts-only');

function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  return fallback;
}

const BATCH_SIZE = Math.max(500, parseInt(getArg('--batch', '5000'), 10) || 5000);

function createPool() {
  if (env.DATABASE_URL) {
    return new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
    });
  }
  return new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  });
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function assertReady(client) {
  const { rows: tables } = await client.query(`
    SELECT
      to_regclass('public.new_seller_details') AS new_seller_details,
      to_regclass('public.new_seller_information') AS new_seller_information,
      to_regclass('public.new_buyer_details') AS new_buyer_details,
      to_regclass('public.new_contracts') AS new_contracts
  `);
  const missingTables = Object.entries(tables[0])
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const { rows: fns } = await client.query(`
    SELECT proname
    FROM pg_proc
    WHERE proname = ANY($1::text[])
  `, [['sync_old_contract_to_new_tables', 'buyer_identity_key', 'seller_contact_key']]);
  const found = new Set(fns.map((r) => r.proname));
  const missingFns = ['sync_old_contract_to_new_tables', 'buyer_identity_key', 'seller_contact_key']
    .filter((n) => !found.has(n));

  const missing = [...missingTables, ...missingFns];
  if (missing.length) {
    throw new Error(
      `New tables flow is not ready (missing: ${missing.join(', ')}). ` +
        'Run dbmate migrations first (20260819100000_sync_new_tables_flow_triggers).'
    );
  }
}

async function printSourceCounts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::bigint FROM contracts) AS contracts,
      (SELECT COUNT(*)::bigint FROM sellers) AS sellers,
      (SELECT COUNT(*)::bigint FROM buyers) AS buyers,
      (SELECT COUNT(*)::bigint FROM sellers WHERE seller_id IS NOT NULL AND BTRIM(seller_id) <> '') AS sellers_with_id,
      (SELECT COUNT(DISTINCT BTRIM(seller_id))::bigint
         FROM sellers
        WHERE seller_id IS NOT NULL AND BTRIM(seller_id) <> '') AS unique_seller_ids,
      (SELECT COUNT(*)::bigint
         FROM buyers
        WHERE NULLIF(BTRIM(COALESCE(company_name, '')), '') IS NOT NULL
           OR NULLIF(BTRIM(COALESCE(phone, '')), '') IS NOT NULL
           OR NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL) AS buyers_with_identity
  `);
  log(`Source counts: ${JSON.stringify(rows[0])}`);
  return rows[0];
}

async function printTargetCounts(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::bigint FROM new_seller_details) AS new_sellers,
      (SELECT COUNT(*)::bigint FROM new_seller_information) AS new_seller_information,
      (SELECT COUNT(*)::bigint FROM new_buyer_details) AS new_buyers,
      (SELECT COUNT(*)::bigint FROM new_contracts) AS new_contracts
  `);
  log(`New table counts: ${JSON.stringify(rows[0])}`);
  return rows[0];
}

async function insertSellers(client) {
  log('Inserting unique sellers into new_seller_details...');
  const { rowCount } = await client.query(`
    INSERT INTO new_seller_details (seller_id, company_name, msme_certificate_number, total_contracts, total_value)
    SELECT DISTINCT ON (BTRIM(s.seller_id))
      BTRIM(s.seller_id),
      NULLIF(BTRIM(s.company_name), ''),
      NULLIF(BTRIM(s.msme_certificate_number), ''),
      COALESCE(agg.cnt, 0),
      COALESCE(agg.val, 0)
    FROM sellers s
    LEFT JOIN (
      SELECT BTRIM(seller_id) AS seller_id,
             COUNT(*)::bigint AS cnt,
             COALESCE(SUM(total_value), 0) AS val
      FROM contracts
      WHERE seller_id IS NOT NULL AND BTRIM(seller_id) <> ''
      GROUP BY BTRIM(seller_id)
    ) agg ON agg.seller_id = BTRIM(s.seller_id)
    WHERE s.seller_id IS NOT NULL
      AND BTRIM(s.seller_id) <> ''
    ORDER BY BTRIM(s.seller_id), s.created_at DESC NULLS LAST, s.id DESC
    ON CONFLICT (seller_id) DO UPDATE
      SET company_name = COALESCE(EXCLUDED.company_name, new_seller_details.company_name),
          msme_certificate_number = COALESCE(
            EXCLUDED.msme_certificate_number,
            new_seller_details.msme_certificate_number
          ),
          total_contracts = EXCLUDED.total_contracts,
          total_value = EXCLUDED.total_value
  `);
  log(`  new_seller_details upserted ${rowCount} rows`);
}

async function insertSellerInformation(client) {
  log('Inserting seller contact rows into new_seller_information...');
  const { rowCount } = await client.query(`
    INSERT INTO new_seller_information (seller_id, phone, email, address, gst_number)
    SELECT DISTINCT ON (nsd.id, seller_contact_key(s.phone, s.email))
      nsd.id,
      NULLIF(BTRIM(s.phone), ''),
      NULLIF(BTRIM(s.email), ''),
      NULLIF(BTRIM(s.address), ''),
      NULLIF(BTRIM(s.gst_number), '')
    FROM sellers s
    JOIN new_seller_details nsd ON nsd.seller_id = BTRIM(s.seller_id)
    WHERE s.seller_id IS NOT NULL
      AND BTRIM(s.seller_id) <> ''
    ORDER BY nsd.id, seller_contact_key(s.phone, s.email), s.created_at DESC NULLS LAST, s.id DESC
    ON CONFLICT (seller_id, contact_key) DO UPDATE
      SET address = COALESCE(EXCLUDED.address, new_seller_information.address),
          gst_number = COALESCE(EXCLUDED.gst_number, new_seller_information.gst_number)
  `);
  log(`  new_seller_information upserted ${rowCount} rows`);
}

async function insertBuyers(client) {
  log('Inserting unique buyers into new_buyer_details...');
  const { rowCount } = await client.query(`
    INSERT INTO new_buyer_details (company_name, phone, email, address, gst_number, total_contracts, total_value)
    SELECT DISTINCT ON (buyer_identity_key(b.company_name, b.phone, b.email))
      NULLIF(BTRIM(b.company_name), ''),
      NULLIF(BTRIM(b.phone), ''),
      NULLIF(BTRIM(b.email), ''),
      NULLIF(BTRIM(b.address), ''),
      NULLIF(BTRIM(b.gst_number), ''),
      COALESCE(agg.cnt, 0),
      COALESCE(agg.val, 0)
    FROM buyers b
    LEFT JOIN (
      SELECT buyer_identity_key(b2.company_name, b2.phone, b2.email) AS identity_key,
             COUNT(*)::bigint AS cnt,
             COALESCE(SUM(c.total_value), 0) AS val
      FROM buyers b2
      JOIN contracts c ON c.id = b2.contract_id
      WHERE NULLIF(BTRIM(COALESCE(b2.company_name, '')), '') IS NOT NULL
         OR NULLIF(BTRIM(COALESCE(b2.phone, '')), '') IS NOT NULL
         OR NULLIF(BTRIM(COALESCE(b2.email, '')), '') IS NOT NULL
      GROUP BY 1
    ) agg ON agg.identity_key = buyer_identity_key(b.company_name, b.phone, b.email)
    WHERE NULLIF(BTRIM(COALESCE(b.company_name, '')), '') IS NOT NULL
       OR NULLIF(BTRIM(COALESCE(b.phone, '')), '') IS NOT NULL
       OR NULLIF(BTRIM(COALESCE(b.email, '')), '') IS NOT NULL
    ORDER BY buyer_identity_key(b.company_name, b.phone, b.email), b.created_at DESC NULLS LAST, b.id DESC
    ON CONFLICT (identity_key) DO UPDATE
      SET address = COALESCE(EXCLUDED.address, new_buyer_details.address),
          gst_number = COALESCE(EXCLUDED.gst_number, new_buyer_details.gst_number),
          total_contracts = EXCLUDED.total_contracts,
          total_value = EXCLUDED.total_value
  `);
  log(`  new_buyer_details upserted ${rowCount} rows`);
}

async function insertContracts(client) {
  log(`Inserting contracts into new_contracts (batch ${BATCH_SIZE})...`);
  let lastId = '00000000-0000-0000-0000-000000000000';
  let processed = 0;
  let upserted = 0;

  while (true) {
    const { rows: batch } = await client.query(
      `SELECT id FROM contracts WHERE id > $1::uuid ORDER BY id LIMIT $2`,
      [lastId, BATCH_SIZE]
    );
    if (!batch.length) break;

    lastId = batch[batch.length - 1].id;
    processed += batch.length;

    const { rowCount } = await client.query(
      `
      INSERT INTO new_contracts (
        id, seller_id, buyer_id, ministry_id,
        contract_number, org_type, org_name, total_value,
        department, office_zone, status_of_the_contract,
        order_id, contract_pdf_url, financial_application,
        paying_authority, products, consinee_details,
        contract_date, created_at
      )
      SELECT
        c.id,
        nsd.id,
        nbd.id,
        c.ministry_id,
        c.contract_number,
        c.org_type,
        c.org_name,
        c.total_value,
        c.department,
        c.office_zone,
        c.status_of_the_contract,
        c.order_id,
        c.contract_pdf_url,
        COALESCE(c.financial_application, '{}'::jsonb),
        COALESCE(c.paying_authority, '{}'::jsonb),
        COALESCE(c.products, '{}'::jsonb),
        COALESCE(c.consinee_details, '{}'::jsonb),
        c.contract_date,
        c.created_at
      FROM contracts c
      JOIN LATERAL (
        SELECT s.seller_id, s.company_name
        FROM sellers s
        WHERE s.contract_id = c.id
          AND s.seller_id IS NOT NULL
          AND BTRIM(s.seller_id) <> ''
        ORDER BY s.created_at DESC NULLS LAST, s.id DESC
        LIMIT 1
      ) s ON TRUE
      JOIN new_seller_details nsd ON nsd.seller_id = BTRIM(s.seller_id)
      JOIN LATERAL (
        SELECT b.company_name, b.phone, b.email
        FROM buyers b
        WHERE b.contract_id = c.id
          AND (
            NULLIF(BTRIM(COALESCE(b.company_name, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(b.phone, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(b.email, '')), '') IS NOT NULL
          )
        ORDER BY b.created_at DESC NULLS LAST, b.id DESC
        LIMIT 1
      ) b ON TRUE
      JOIN new_buyer_details nbd
        ON nbd.identity_key = buyer_identity_key(b.company_name, b.phone, b.email)
      WHERE c.id = ANY($1::uuid[])
        AND c.ministry_id IS NOT NULL
      ON CONFLICT (id) DO UPDATE
        SET seller_id = EXCLUDED.seller_id,
            buyer_id = EXCLUDED.buyer_id,
            ministry_id = EXCLUDED.ministry_id,
            contract_number = EXCLUDED.contract_number,
            org_type = EXCLUDED.org_type,
            org_name = EXCLUDED.org_name,
            total_value = EXCLUDED.total_value,
            department = EXCLUDED.department,
            office_zone = EXCLUDED.office_zone,
            status_of_the_contract = EXCLUDED.status_of_the_contract,
            order_id = EXCLUDED.order_id,
            contract_pdf_url = EXCLUDED.contract_pdf_url,
            financial_application = EXCLUDED.financial_application,
            paying_authority = EXCLUDED.paying_authority,
            products = EXCLUDED.products,
            consinee_details = EXCLUDED.consinee_details,
            contract_date = EXCLUDED.contract_date
      `,
      [batch.map((r) => r.id)]
    );

    upserted += rowCount || 0;
    log(`  processed ${processed} contracts, upserted ${upserted}`);
  }

  log(`  new_contracts upserted ${upserted} rows from ${processed} source contracts`);
}

async function seedCounts(client) {
  log('Seeding seller / buyer contract counts from new_contracts...');

  const { rows: fnRows } = await client.query(`
    SELECT 1 FROM pg_proc WHERE proname = 'refresh_new_table_counts' LIMIT 1
  `);

  if (fnRows[0]) {
    await client.query('SELECT refresh_new_table_counts()');
  } else {
    await client.query(`
      UPDATE new_seller_details
      SET total_contracts = 0, total_value = 0
    `);
    await client.query(`
      UPDATE new_seller_details nsd
      SET total_contracts = sub.cnt,
          total_value = sub.val
      FROM (
        SELECT seller_id,
               COUNT(*)::bigint AS cnt,
               COALESCE(SUM(total_value), 0) AS val
        FROM new_contracts
        GROUP BY seller_id
      ) sub
      WHERE nsd.id = sub.seller_id
    `);

    await client.query(`
      UPDATE new_buyer_details
      SET total_contracts = 0, total_value = 0
    `);
    await client.query(`
      UPDATE new_buyer_details nbd
      SET total_contracts = sub.cnt,
          total_value = sub.val
      FROM (
        SELECT buyer_id,
               COUNT(*)::bigint AS cnt,
               COALESCE(SUM(total_value), 0) AS val
        FROM new_contracts
        GROUP BY buyer_id
      ) sub
      WHERE nbd.id = sub.buyer_id
    `);
  }

  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*) FILTER (WHERE total_contracts > 0)::bigint FROM new_seller_details) AS sellers_with_contracts,
      (SELECT COALESCE(SUM(total_contracts), 0) FROM new_seller_details) AS seller_contract_sum,
      (SELECT COALESCE(SUM(total_value), 0) FROM new_seller_details) AS seller_value_sum,
      (SELECT COUNT(*) FILTER (WHERE total_contracts > 0)::bigint FROM new_buyer_details) AS buyers_with_contracts,
      (SELECT COALESCE(SUM(total_contracts), 0) FROM new_buyer_details) AS buyer_contract_sum
  `);
  log(`  counts seeded: ${JSON.stringify(rows[0])}`);
}

async function main() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout = 0');
    await assertReady(client);
    await printSourceCounts(client);
    await printTargetCounts(client);

    if (DRY_RUN) {
      log('Dry run only — no data written.');
      return;
    }

    if (COUNTS_ONLY) {
      await seedCounts(client);
      await printTargetCounts(client);
      log('Counts refreshed from new_contracts.');
      return;
    }

    await client.query('ALTER TABLE new_contracts DISABLE TRIGGER trigger_update_new_party_counts');

    if (FRESH) {
      log('Truncating new tables (--fresh)...');
      await client.query(`
        TRUNCATE TABLE new_contracts, new_seller_information, new_buyer_details, new_seller_details
        RESTART IDENTITY
      `);
    }

    await insertSellers(client);
    await insertSellerInformation(client);
    await insertBuyers(client);
    await insertContracts(client);
    await seedCounts(client);

    await printTargetCounts(client);
    log('Done. Live inserts into contracts/sellers/buyers will now sync into the new tables via triggers.');
  } finally {
    try {
      await client.query('ALTER TABLE new_contracts ENABLE TRIGGER trigger_update_new_party_counts');
    } catch {
      // ignore if migration was missing or connection already closed
    }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
