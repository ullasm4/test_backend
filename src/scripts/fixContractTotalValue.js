/**
 * After contracts are already checked (seller, buyer, and PDF saved),
 * re-read each PDF and set total_value from the contract-total label.
 *
 * Formats:
 *   - Total Contract Value Including All Duties and Taxes (INR)   service
 *   - Total Order Value (in INR)                                  goods
 *   - Sum of Total Value Including Addons (INR)                   multi-schedule service
 *   - Sum of product line totals                                  goods rows
 *
 * Usage:
 *   node src/scripts/fixContractTotalValue.js
 *   node src/scripts/fixContractTotalValue.js --after-created=10-9-2026 --parts=10 --part=1
 *   node src/scripts/fixContractTotalValue.js --after-created=10-09-2026 --dry-run
 *   node src/scripts/fixContractTotalValue.js --from=2026-07-01 --to=2026-07-31 --yes
 *   node src/scripts/fixContractTotalValue.js --contract=GEMC-511687799630005
 */

require('module-alias/register');
require('@/config/env');

const readline = require('readline');
const axios = require('axios');
const { Pool } = require('pg');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { PDFParse } = require('pdf-parse');
const env = require('@/config/env');
const { extractContractTotalValue } = require('@/gem/pdf_parse_sections');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const YES = args.includes('--yes');
const CONCURRENCY = 4;
const BATCH_SIZE = 40;

function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
  return fallback;
}

function createPool() {
  const timeouts = {
    max: 6,
    connectionTimeoutMillis: 20000,
  };
  if (env.DATABASE_URL) {
    return new Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
      ...timeouts,
    });
  }
  return new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
    ...timeouts,
  });
}

function createS3() {
  const config = { region: env.AWS_REGION || 'ap-south-1' };
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }
  return new S3Client(config);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD, DD-MM-YYYY, or DD/MM/YYYY → ISO date. */
function parseDate(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoDate(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return isoDate(m[3], m[2], m[1]);
  return null;
}

/** Day or whole month (MM-YYYY / YYYY-MM) → { from, to }. */
function parseDateWindow(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const day = parseDate(s);
  if (day) return { from: day, to: day };

  let m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return monthWindow(m[2], m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return monthWindow(m[1], m[2]);
  return null;
}

function monthWindow(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: isoDate(y, m, 1), to: isoDate(y, m, last) };
}

function isoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

async function resolveWindow() {
  const contract = String(getArg('--contract', '') || '').trim().toUpperCase();
  const afterArg = getArg('--after-created', '') || getArg('--date', '');
  const dateArg = afterArg && !getArg('--from', '') && !getArg('--to', '') ? '' : getArg('--date', '');
  const fromArg = getArg('--from', '');
  const toArg = getArg('--to', '');

  let from = null;
  let to = null;
  let afterCreated = null;

  if (afterArg && !fromArg && !toArg) {
    afterCreated = parseDate(afterArg);
    if (!afterCreated) {
      throw new Error(
        `Invalid date "${afterArg}". Use DD-MM-YYYY (example 10-9-2026) or YYYY-MM-DD.`
      );
    }
  } else if (dateArg && !fromArg && !toArg) {
    const window = parseDateWindow(dateArg);
    if (!window) {
      throw new Error(`Invalid --date "${dateArg}". Use YYYY-MM-DD, DD-MM-YYYY, or MM-YYYY.`);
    }
    from = window.from;
    to = window.to;
  } else if (fromArg || toArg) {
    const start = parseDateWindow(fromArg || toArg);
    const end = parseDateWindow(toArg || fromArg);
    if (!start || !end) {
      throw new Error('Invalid --from/--to. Use YYYY-MM-DD, DD-MM-YYYY, or MM-YYYY.');
    }
    from = start.from;
    to = end.to;
  } else if (!contract) {
    const typed = await ask('Enter contract date (YYYY-MM-DD, DD-MM-YYYY, or MM-YYYY): ');
    const range = typed.split(/\s*(?:\.\.|to)\s*/i);
    const start = parseDateWindow(range[0]);
    const end = parseDateWindow(range[1] || range[0]);
    if (!start || !end) {
      throw new Error(`Invalid date "${typed}". Use YYYY-MM-DD, DD-MM-YYYY, or MM-YYYY.`);
    }
    from = start.from;
    to = end.to;
  }

  if (from && to && from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  return { from, to, contract, afterCreated };
}

function s3FromUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname;
  const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const virtual = host.match(/^(.+)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/i);
  if (virtual) return { bucket: virtual[1], key: path };
  const pathStyle = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/i);
  if (pathStyle) {
    const parts = path.split('/');
    return { bucket: parts.shift(), key: parts.join('/') };
  }
  return null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function downloadPdf(url, s3) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 45000,
      headers: { Accept: 'application/pdf,*/*' },
      validateStatus: () => true,
    });
    if (res.status < 400 && res.data) {
      const buf = Buffer.from(res.data);
      if (buf.slice(0, 5).toString() === '%PDF-') return buf;
    }
  } catch {
    // fall through to S3
  }

  const loc = s3FromUrl(url);
  if (!loc?.bucket || !loc.key) {
    throw new Error('PDF download failed and URL is not an S3 object');
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45000);
  let out;
  try {
    out = await s3.send(new GetObjectCommand({ Bucket: loc.bucket, Key: loc.key }), {
      abortSignal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const buf = await streamToBuffer(out.Body);
  if (buf.slice(0, 5).toString() !== '%PDF-') throw new Error('S3 object is not a PDF');
  return buf;
}

async function extractPdfText(buf) {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result.text || '');
  } finally {
    if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
  }
}

function resolvePart() {
  const parts = Number(getArg('--parts', 0) || 0);
  const part = Number(getArg('--part', 0) || 0);
  if (!part && !parts) return { part: 0, parts: 0 };
  if (!parts || parts < 1 || !part || part < 1 || part > parts) {
    throw new Error('Use --parts=N with --part=K (example --parts=10 --part=1)');
  }
  return { part, parts };
}

function moneyEqual(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.01;
}

function contractWhere(window, part, parts) {
  const params = [];
  const where = [
    'c.seller_id IS NOT NULL',
    'c.buyer_id IS NOT NULL',
    'c.contract_pdf_url IS NOT NULL',
    "BTRIM(c.contract_pdf_url) <> ''",
  ];
  if (window.contract) {
    params.push(window.contract);
    where.push(`upper(c.contract_number) = $${params.length}`);
  } else if (window.afterCreated) {
    // Start of the next IST day, so the created_at index can be used.
    params.push(window.afterCreated);
    where.push(
      `c.created_at >= (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Kolkata')`
    );
  } else {
    params.push(window.from, window.to);
    where.push(`c.contract_date >= $${params.length - 1}::date`);
    where.push(`c.contract_date <= $${params.length}::date`);
  }
  if (parts > 1) {
    params.push(parts, part - 1);
    where.push(
      `((hashtext(c.id::text) % $${params.length - 1}) + $${params.length - 1}) % $${params.length - 1} = $${params.length}`
    );
  }
  return { where: where.join(' AND '), params };
}

async function countContracts(pool, window, part, parts) {
  const { where, params } = contractWhere(window, part, parts);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM new_contracts c WHERE ${where}`,
    params
  );
  return rows[0]?.n || 0;
}

async function fetchBatch(pool, window, part, parts, cursor) {
  const { where, params } = contractWhere(window, part, parts);
  let cursorSql = '';
  if (cursor) {
    params.push(cursor.created_at, cursor.id);
    cursorSql = ` AND (c.created_at, c.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(BATCH_SIZE);
  const { rows } = await pool.query(
    `SELECT c.id, c.seller_id, c.contract_number, c.contract_date, c.created_at, c.total_value, c.contract_pdf_url
     FROM new_contracts c
     WHERE ${where}${cursorSql}
     ORDER BY c.created_at, c.id
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Seller total is the sum of that seller's contracts, not a plus/minus on the old number.
 * Contract update and seller update run in one transaction.
 */
async function saveContractAndSeller(pool, { contractId, sellerId, total }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE new_contracts
       SET total_value = $2::numeric
       WHERE id = $1
         AND total_value IS DISTINCT FROM $2::numeric
       RETURNING seller_id`,
      [contractId, total]
    );
    const id = sellerId || updated.rows[0]?.seller_id;
    let sellerChanged = false;
    if (id) {
      const seller = await client.query(
        `UPDATE new_seller_details nsd
         SET total_value = sums.val
         FROM (
           SELECT COALESCE(SUM(c.total_value), 0) AS val
           FROM new_contracts c
           WHERE c.seller_id = $1
         ) sums
         WHERE nsd.id = $1
           AND nsd.total_value IS DISTINCT FROM sums.val`,
        [id]
      );
      sellerChanged = (seller.rowCount || 0) > 0;
    }
    await client.query('COMMIT');
    return { contractChanged: (updated.rowCount || 0) > 0, sellerChanged };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Fix sellers whose contracts were already corrected, so a rerun still updates them. */
async function syncSellerTotalsForWindow(pool, window, part, parts) {
  const { where, params } = contractWhere(window, part, parts);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 0');
    const result = await client.query(
      `UPDATE new_seller_details nsd
       SET total_value = sums.val
       FROM (
         SELECT nc.seller_id, COALESCE(SUM(nc.total_value), 0) AS val
         FROM new_contracts nc
         WHERE nc.seller_id IN (
           SELECT DISTINCT c.seller_id
           FROM new_contracts c
           WHERE ${where}
             AND c.seller_id IS NOT NULL
         )
         GROUP BY nc.seller_id
       ) sums
       WHERE nsd.id = sums.seller_id
         AND nsd.total_value IS DISTINCT FROM sums.val`,
      params
    );
    await client.query('COMMIT');
    return result.rowCount || 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function run() {
  console.log('Starting total_value fix...');
  const window = await resolveWindow();
  const { part, parts } = resolvePart();
  const pool = createPool();
  const s3 = createS3();

  try {
    console.log('Counting matching contracts...');
    const total = await countContracts(pool, window, part, parts);
    const label = window.contract
      ? window.contract
      : window.afterCreated
        ? `created_at after ${window.afterCreated}`
        : window.from === window.to
          ? window.from
          : `${window.from} → ${window.to}`;
    const partLabel = parts ? ` | part ${part}/${parts}` : '';
    console.log(`Matched ${total} (${label}${partLabel}).`);
    if (!total) {
      console.log('Nothing to update. Only contracts that already have seller, buyer, and PDF are included.');
      return;
    }
    if (DRY_RUN) console.log('Dry run — no writes.');

    let updated = 0;
    let sellersUpdated = 0;
    if (!DRY_RUN) {
      console.log('Setting seller totals from the sum of their contracts...');
      sellersUpdated += await syncSellerTotalsForWindow(pool, window, part, parts);
      console.log(`Seller totals set from contracts: ${sellersUpdated}`);
    }
    console.log(`Reading PDFs in batches of ${BATCH_SIZE}.`);

    if (!DRY_RUN && !YES) {
      const ok = await ask(`Read ${total} PDF(s) and set total_value? (y/N): `);
      if (!/^y(es)?$/i.test(ok)) {
        console.log('Cancelled.');
        return;
      }
    }

    let unchanged = 0;
    let missing = 0;
    let failed = 0;
    let seen = 0;
    let cursor = null;

    for (;;) {
      const rows = await fetchBatch(pool, window, part, parts, cursor);
      if (!rows.length) break;
      const last = rows[rows.length - 1];
      cursor = { created_at: last.created_at, id: last.id };

      await mapPool(rows, CONCURRENCY, async (row) => {
        const number = row.contract_number;
        seen += 1;
        const n = seen;
        console.log(`  [${n}/${total}] ${number} reading PDF...`);
        try {
          const buf = await downloadPdf(row.contract_pdf_url, s3);
          const text = await extractPdfText(buf);
          const next = extractContractTotalValue(text);
          if (next == null) {
            missing += 1;
            console.log(`  ${number}  no contract total in PDF (kept ${row.total_value ?? 'null'})`);
            return;
          }
          if (moneyEqual(row.total_value, next)) {
            unchanged += 1;
            console.log(`  ${number}  already ${next}`);
            return;
          }
          console.log(`  ${number}  ${row.total_value ?? 'null'} → ${next}`);
          if (!DRY_RUN) {
            const saved = await saveContractAndSeller(pool, {
              contractId: row.id,
              sellerId: row.seller_id,
              total: next,
            });
            if (saved.sellerChanged) {
              sellersUpdated += 1;
              console.log(`  ${number}  seller total set from contract sum`);
            }
          }
          updated += 1;
        } catch (err) {
          failed += 1;
          console.log(`  ${number}  FAILED  ${err.message}`);
        }
      });

    }

    console.log(
      `Done. updated=${updated} sellers=${sellersUpdated} unchanged=${unchanged} no-total=${missing} failed=${failed}`
    );
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
