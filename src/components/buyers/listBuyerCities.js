const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { parseUuidList } = require('@/lib/parseUuidList');

exports.validationSchema = {
  query: Joi.object({
    q: Schema.search(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    offset: Joi.number().integer().min(0).default(0),
    state: Joi.string().trim().optional().allow(''),
    include_id: Schema.uuidList().optional().allow('', null),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const q = (req.customQuery.q || '').trim();
  const stateVal = (req.customQuery.state || '').trim();
  const includeIds = parseUuidList(req.customQuery.include_id);
  const limit = Math.min(Number(req.customQuery.limit) || 10, constant.pagination.maxLimit || 200);
  const offset = Math.max(0, Number(req.customQuery.offset) || 0);
  const params = [];
  const clauses = [];

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`c.name ILIKE $${params.length}`);
  }

  if (stateVal) {
    const match = stateVal.match(/\b\d{2}\b/) || stateVal.match(/\d{2}/);
    if (match) {
      params.push(match[0]);
      clauses.push(`EXISTS (
        SELECT 1 FROM states st
        WHERE st.id = c.state_id AND st.gst_code = $${params.length}
      )`);
    } else {
      params.push(stateVal);
      clauses.push(`EXISTS (
        SELECT 1 FROM states st
        WHERE st.id = c.state_id AND st.name ILIKE $${params.length}
      )`);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit + 1);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await db.query(
    `
      SELECT c.id::text AS value, c.name AS label
      FROM cities c
      ${where}
      ORDER BY c.name ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  if (includeIds.length && offset === 0) {
    const missing = includeIds.filter((id) => !data.some((r) => r.value === id));
    if (missing.length) {
      const included = await db.query(
        `SELECT c.id::text AS value, c.name AS label
         FROM cities c
         WHERE c.id = ANY($1::uuid[])
         ORDER BY c.name ASC`,
        [missing]
      );
      data.unshift(...included.rows);
    }
  }

  return res.status(200).json({ data, has_more: hasMore, limit, offset });
};
