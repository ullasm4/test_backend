const XLSX = require('xlsx');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const {
  cleanText,
  normalizeEmailList,
  normalizePhoneList,
  toDbArray,
} = require('@/lib/buyerLeadContacts');

exports.validationSchema = {};

const HEADER_ALIASES = {
  sr_no: ['sr. no.', 'sr no', 'sr_no', 'srno', 's.no', 's no', 'serial', 'serial no'],
  name: ['name', 'company', 'company name', 'buyer name', 'firm name'],
  phone: [
    'phone number',
    'phone',
    'phones',
    'mobile',
    'mobile number',
    'contact',
    'contact number',
  ],
  email: ['email id', 'email', 'emails', 'email address', 'e-mail', 'email ids'],
  website: ['website / other links', 'website', 'website / other link', 'other links', 'url', 'link'],
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveField(header) {
  const normalized = normalizeHeader(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}

function cleanSrNo(value) {
  if (value == null || value === '') return null;
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(num)) return null;
  return Math.trunc(num);
}

function parseRowsFromBuffer(buffer, originalName = '') {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ServerError('Uploaded file has no sheets', 400, ErrorCode.BAD_REQUEST);
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  if (!matrix.length) {
    throw new ServerError('Uploaded file is empty', 400, ErrorCode.BAD_REQUEST);
  }

  const headerRow = matrix[0] || [];
  const fieldIndex = {};
  headerRow.forEach((header, index) => {
    const field = resolveField(header);
    if (field && fieldIndex[field] == null) fieldIndex[field] = index;
  });

  if (fieldIndex.name == null) {
    throw new ServerError(
      'Missing required "Name" column. Expected headers like: Sr. No., Name, Phone Number, Email ID, Website / Other Links',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const rows = [];
  const seenEmails = new Set();
  let skippedFileDupes = 0;

  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] || [];
    const name = cleanText(line[fieldIndex.name]);
    if (!name) continue;

    const phones =
      fieldIndex.phone != null ? normalizePhoneList(line[fieldIndex.phone]) : [];
    const emails =
      fieldIndex.email != null ? normalizeEmailList(line[fieldIndex.email]) : [];
    const emailKeys = emails.map((email) => email.toLowerCase());

    if (emailKeys.some((key) => seenEmails.has(key))) {
      skippedFileDupes += 1;
      continue;
    }
    emailKeys.forEach((key) => seenEmails.add(key));

    rows.push({
      sr_no: fieldIndex.sr_no != null ? cleanSrNo(line[fieldIndex.sr_no]) : null,
      name,
      phone: phones,
      email: emails,
      website: fieldIndex.website != null ? cleanText(line[fieldIndex.website]) : null,
      email_keys: emailKeys,
    });
  }

  if (!rows.length) {
    throw new ServerError(
      `No valid rows found in ${originalName || 'uploaded file'}`,
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  return { rows, skippedFileDupes };
}

exports.controller = async (req, res, _next, db) => {
  if (!req.file?.buffer?.length) {
    throw new ServerError('CSV or Excel file is required', 400, ErrorCode.BAD_REQUEST);
  }

  const { rows, skippedFileDupes } = parseRowsFromBuffer(req.file.buffer, req.file.originalname);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const emailKeys = [...new Set(rows.flatMap((r) => r.email_keys))];
    const existing = new Set();
    if (emailKeys.length) {
      const { rows: existingRows } = await client.query(
        `
          SELECT DISTINCT LOWER(BTRIM(e.email)) AS email_key
          FROM buyer_lead bl
          CROSS JOIN LATERAL unnest(COALESCE(bl.email, ARRAY[]::text[])) AS e(email)
          WHERE e.email IS NOT NULL
            AND BTRIM(e.email) <> ''
            AND LOWER(BTRIM(e.email)) = ANY($1::text[])
        `,
        [emailKeys]
      );
      existingRows.forEach((r) => {
        if (r.email_key) existing.add(r.email_key);
      });
    }

    const toInsert = [];
    let skippedExisting = 0;
    for (const row of rows) {
      if (row.email_keys.some((key) => existing.has(key))) {
        skippedExisting += 1;
        continue;
      }
      row.email_keys.forEach((key) => existing.add(key));
      toInsert.push(row);
    }

    let inserted = 0;
    const chunkSize = 200;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      if (!chunk.length) continue;

      const values = [];
      const placeholders = chunk.map((row, rowIdx) => {
        const base = rowIdx * 5;
        values.push(
          row.sr_no,
          row.name,
          toDbArray(row.phone),
          toDbArray(row.email),
          row.website
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}::text[], $${base + 4}::text[], $${base + 5})`;
      });

      const result = await client.query(
        `
          INSERT INTO buyer_lead (sr_no, name, phone, email, website)
          VALUES ${placeholders.join(', ')}
        `,
        values
      );
      inserted += result.rowCount || chunk.length;
    }

    await client.query('COMMIT');
    return res.status(201).json({
      message: `Imported ${inserted} buyer lead(s)`,
      inserted,
      skipped_duplicates: skippedFileDupes + skippedExisting,
      skipped_file_duplicates: skippedFileDupes,
      skipped_existing_emails: skippedExisting,
      total_rows: rows.length + skippedFileDupes,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
