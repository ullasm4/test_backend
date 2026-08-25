const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const constant = require('@/config/constant');
const { VALUE_RANGE_KEYS, getValueRange, valueRangeSql } = require('@/lib/contractValueRanges');
const {
  PRIMARY_SELLER_CONTACT,
  HAS_PHONE_SQL,
  HAS_EMAIL_SQL,
  SELLER_LIST_COLUMNS,
} = require('@/lib/newTableSql');
const { getSellerMailCooldownsForRows } = require('@/service/mail/mailSendLimits');
const { getSellerWhatsAppCooldownsForRows } = require('@/service/whatsapp/whatsappSendLimits');

const stateCache = new Map();

exports.validationSchema = {
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(constant.pagination.maxLimit),
    q: Schema.search(),
    state: Joi.string().trim().optional().allow(''),
    has_phone: Joi.boolean().optional(),
    has_email: Joi.boolean().optional(),
    unique_phone: Joi.boolean().optional(),
    unique_email: Joi.boolean().optional(),
    unique_gst: Joi.boolean().optional(),
    remaining_whatsapp: Joi.boolean().optional(),
    remaining_email: Joi.boolean().optional(),
    assigned: Joi.boolean().optional(),
    unassigned: Joi.boolean().optional(),
    assigned_user_id: Schema.uuid().optional().allow(''),
    sort_value: Joi.string().trim().optional().allow(''),
    value_op: Joi.string().trim().optional().allow(''),
    value_amount: Joi.number().optional().allow('', null),
    value_range: Joi.string().valid(...VALUE_RANGE_KEYS).allow(''),
  }),
};

function uniqueGrain({ uniquePhone, uniqueEmail, uniqueGst }) {
  if (uniquePhone) return 'phone';
  if (uniqueEmail) return 'email';
  if (uniqueGst) return 'gst';
  return 'seller';
}

function orderBy(sortValue) {
  const key = (sortValue || '').toLowerCase().trim();
  if (key === 'high_to_low' || key === 'desc') {
    return 'COALESCE(sd.total_value, 0) DESC, sd.company_name ASC NULLS LAST';
  }
  if (key === 'low_to_high' || key === 'asc') {
    return 'COALESCE(sd.total_value, 0) ASC, sd.company_name ASC NULLS LAST';
  }
  return 'sd.total_contracts DESC NULLS LAST, sd.total_value DESC NULLS LAST, sd.company_name ASC NULLS LAST';
}

exports.controller = async (req, res, _next, db) => {
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || 20;
  const offset = (page - 1) * limit;
  const q = req.customQuery.q || '';
  const stateVal = (req.customQuery.state || '').trim();
  const hasPhone = req.customQuery.has_phone === true || req.customQuery.has_phone === 'true';
  const hasEmail = req.customQuery.has_email === true || req.customQuery.has_email === 'true';
  const uniquePhone = req.customQuery.unique_phone === true || req.customQuery.unique_phone === 'true';
  const uniqueEmail = req.customQuery.unique_email === true || req.customQuery.unique_email === 'true';
  const uniqueGst = req.customQuery.unique_gst === true || req.customQuery.unique_gst === 'true';
  const remainingWhatsApp =
    req.customQuery.remaining_whatsapp === true || req.customQuery.remaining_whatsapp === 'true';
  const remainingEmail =
    req.customQuery.remaining_email === true || req.customQuery.remaining_email === 'true';
  const assigned =
    req.customQuery.assigned === true || req.customQuery.assigned === 'true';
  const unassigned =
    req.customQuery.unassigned === true || req.customQuery.unassigned === 'true';
  const assignedUserId = (req.customQuery.assigned_user_id || '').trim();
  const sortValue = (req.customQuery.sort_value || req.customQuery.sort || '').toLowerCase().trim();
  const valueOp = (req.customQuery.value_op || 'gte').toLowerCase().trim();
  const valueAmount = req.customQuery.value_amount;
  const valueRangeKey = req.customQuery.value_range || '';
  const valueRange = getValueRange(valueRangeKey);
  const grain = uniqueGrain({ uniquePhone, uniqueEmail, uniqueGst });
  const rankedOrderBy = orderBy(sortValue);

  const params = [];
  const clauses = [];

  const isUserRole = req.user && req.user.role !== 'admin';
  if (isUserRole) {
    params.push(req.user.id);
    clauses.push(`EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id AND uas.user_id = $${params.length}
    )`);
  }

  if (assignedUserId) {
    params.push(assignedUserId);
    clauses.push(`EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id AND uas.user_id = $${params.length}
    )`);
  } else if (unassigned) {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id
    )`);
  } else if (assigned) {
    clauses.push(`EXISTS (
      SELECT 1 FROM user_assign_sellers uas
      WHERE uas.seller_id = sd.id
    )`);
  }

  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(
      sd.company_name ILIKE $${params.length} OR
      sd.seller_id ILIKE $${params.length} OR
      EXISTS (
        SELECT 1 FROM new_seller_information x
        WHERE x.seller_id = sd.id AND (
          x.email ILIKE $${params.length} OR
          x.phone ILIKE $${params.length} OR
          x.gst_number ILIKE $${params.length}
        )
      )
    )`);
  }

  if (stateVal) {
    let stateCode = '';
    const match = stateVal.match(/\b\d{2}\b/) || stateVal.match(/\d{2}/);
    if (match) {
      stateCode = match[0];
    } else {
      const cacheKey = stateVal.toLowerCase();
      if (stateCache.has(cacheKey)) {
        stateCode = stateCache.get(cacheKey);
      } else {
        const stateRes = await db.query(
          `SELECT gst_code FROM states WHERE LOWER(name) ILIKE LOWER($1) OR name ILIKE $2 LIMIT 1`,
          [stateVal, `%${stateVal}%`]
        );
        if (stateRes.rows[0]?.gst_code) {
          stateCode = stateRes.rows[0].gst_code;
          stateCache.set(cacheKey, stateCode);
        }
      }
    }

    if (stateCode) {
      params.push(`${stateCode.trim()}%`);
      clauses.push(`EXISTS (
        SELECT 1 FROM new_seller_information x
        WHERE x.seller_id = sd.id AND x.gst_number LIKE $${params.length}
      )`);
    }
  }

  if (hasPhone || uniquePhone || remainingWhatsApp) {
    clauses.push(HAS_PHONE_SQL);
  }

  if (hasEmail || uniqueEmail || remainingEmail) {
    clauses.push(HAS_EMAIL_SQL);
  }

  if (remainingWhatsApp) {
    clauses.push('sd.whatsapp_sent IS NOT TRUE');
  }

  if (remainingEmail) {
    clauses.push('sd.email_sent IS NOT TRUE');
  }

  if (uniqueGst && !uniquePhone && !uniqueEmail) {
    clauses.push(`EXISTS (
      SELECT 1 FROM new_seller_information x
      WHERE x.seller_id = sd.id AND x.gst_number IS NOT NULL AND BTRIM(x.gst_number) <> ''
    )`);
  }

  let hasValueFilter = Boolean(valueRange);
  if (!valueRange && valueAmount !== undefined && valueAmount !== null && valueAmount !== '') {
    const valAmt = Number(valueAmount);
    if (!Number.isNaN(valAmt)) {
      hasValueFilter = true;
      params.push(valAmt);
      if (valueOp === 'lte' || valueOp === 'less_than' || valueOp === '<') {
        clauses.push(`COALESCE(sd.total_value, 0) <= $${params.length}`);
      } else if (valueOp === 'eq' || valueOp === 'equal' || valueOp === '=') {
        clauses.push(`COALESCE(sd.total_value, 0) = $${params.length}`);
      } else {
        clauses.push(`COALESCE(sd.total_value, 0) >= $${params.length}`);
      }
    }
  }

  const rangeClause = valueRangeSql(valueRange, params, 'COALESCE(sd.total_value, 0)');
  if (rangeClause) clauses.push(rangeClause);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const unfiltered =
    !isUserRole &&
    !assigned &&
    !unassigned &&
    !assignedUserId &&
    !q &&
    !stateVal &&
    !hasPhone &&
    !hasEmail &&
    !uniquePhone &&
    !uniqueEmail &&
    !uniqueGst &&
    !remainingWhatsApp &&
    !remainingEmail &&
    !hasValueFilter;
  const dataParams = [...params, limit, offset];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;

  let countSql;
  let countParams = params;
  let dataSql;

  if (grain === 'seller') {
    countSql = unfiltered
      ? `SELECT COALESCE(new_sellers, 0)::int AS total FROM total_counts WHERE id = 1`
      : `SELECT COUNT(*)::int AS total FROM new_seller_details sd ${where}`;
    countParams = unfiltered ? [] : params;
    dataSql = `
      WITH page AS (
        SELECT sd.id
        FROM new_seller_details sd
        ${where}
        ORDER BY ${rankedOrderBy}
        LIMIT $${limIdx} OFFSET $${offIdx}
      )
      SELECT ${SELLER_LIST_COLUMNS}
      FROM page p
      JOIN new_seller_details sd ON sd.id = p.id
      ${PRIMARY_SELLER_CONTACT}
      LEFT JOIN user_assign_sellers uas ON uas.seller_id = sd.id
      LEFT JOIN users u ON u.id = uas.user_id
      ORDER BY ${rankedOrderBy}
    `;
  } else {
    const distinctExpr =
      grain === 'phone'
        ? `LOWER(BTRIM(si.phone))`
        : grain === 'email'
          ? `LOWER(BTRIM(si.email))`
          : `LOWER(BTRIM(si.gst_number))`;
    const presentClause =
      grain === 'phone'
        ? `si.phone IS NOT NULL AND BTRIM(si.phone) <> ''`
        : grain === 'email'
          ? `si.email IS NOT NULL AND BTRIM(si.email) <> ''`
          : `si.gst_number IS NOT NULL AND BTRIM(si.gst_number) <> ''`;

    countSql = `
      SELECT COUNT(*)::int AS total FROM (
        SELECT DISTINCT ${distinctExpr}
        FROM new_seller_information si
        JOIN new_seller_details sd ON sd.id = si.seller_id
        ${where ? `${where} AND ${presentClause}` : `WHERE ${presentClause}`}
      ) t
    `;
    dataSql = `
      WITH ranked AS (
        SELECT DISTINCT ON (${distinctExpr})
          ${SELLER_LIST_COLUMNS}
        FROM new_seller_information si
        JOIN new_seller_details sd ON sd.id = si.seller_id
        LEFT JOIN user_assign_sellers uas ON uas.seller_id = sd.id
        LEFT JOIN users u ON u.id = uas.user_id
        ${where ? `${where} AND ${presentClause}` : `WHERE ${presentClause}`}
        ORDER BY ${distinctExpr}, ${rankedOrderBy}, si.id
      )
      SELECT * FROM ranked
      ORDER BY ${rankedOrderBy.replace(/sd\./g, '')}
      LIMIT $${limIdx} OFFSET $${offIdx}
    `;
  }

  const [countRes, rowsRes] = await Promise.all([
    db.query(countSql, countParams),
    db.query(dataSql, dataParams),
  ]);

  const rows = rowsRes.rows || [];
  const [mailCooldownBySeller, whatsappCooldownBySeller] = await Promise.all([
    getSellerMailCooldownsForRows(db, rows),
    getSellerWhatsAppCooldownsForRows(db, rows),
  ]);
  const data = rows.map((row) => ({
    ...row,
    mail_cooldown: mailCooldownBySeller.get(row.id) || {
      allowed: true,
      last_sent_at: null,
      next_allowed_at: null,
      cooldown_days: 6,
    },
    whatsapp_cooldown: whatsappCooldownBySeller.get(row.id) || {
      allowed: true,
      last_sent_at: null,
      next_allowed_at: null,
      cooldown_days: 6,
    },
  }));

  return res.status(200).json({ data, total: countRes.rows[0]?.total || 0, page, limit });
};
