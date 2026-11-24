const XLSX = require('xlsx');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {};

const HEADER_ALIASES = {
  sr_no: ['sr. no.', 'sr no', 'sr_no', 'srno', 's.no', 's no', 'serial', 'serial no'],
  name: ['name', 'company', 'company name', 'buyer name', 'firm name'],
  phone: ['phone number', 'phone', 'mobile', 'mobile number', 'contact', 'contact number'],
  email: ['email id', 'email', 'email address', 'e-mail'],
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

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeEmail(value) {
  const email = cleanText(value);
  return email ? email.toLowerCase() : null;
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

    const email = fieldIndex.email != null ? cleanText(line[fieldIndex.email]) : null;
    const emailKey = normalizeEmail(email);

    if (emailKey) {
      if (seenEmails.has(emailKey)) {
        skippedFileDupes += 1;
        continue;
      }
      seenEmails.add(emailKey);
    }

    rows.push({
      sr_no: fieldIndex.sr_no != null ? cleanSrNo(line[fieldIndex.sr_no]) : null,
      name,
      phone: fieldIndex.phone != null ? cleanText(line[fieldIndex.phone]) : null,
      email,
      website: fieldIndex.website != null ? cleanText(line[fieldIndex.website]) : null,
      email_key: emailKey,
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

    const emailKeys = [...new Set(rows.map((r) => r.email_key).filter(Boolean))];
    const existing = new Set();
    if (emailKeys.length) {
      const { rows: existingRows } = await client.query(
        `
          SELECT LOWER(BTRIM(email)) AS email_key
          FROM buyer_lead
          WHERE email IS NOT NULL
            AND BTRIM(email) <> ''
            AND LOWER(BTRIM(email)) = ANY($1::text[])
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
      if (row.email_key && existing.has(row.email_key)) {
        skippedExisting += 1;
        continue;
      }
      if (row.email_key) existing.add(row.email_key);
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
        values.push(row.sr_no, row.name, row.phone, row.email, row.website);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
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
