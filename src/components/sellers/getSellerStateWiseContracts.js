const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const sellerId = req.params.id;

  // 1. Verify seller exists
  const sellerRes = await db.query(
    `SELECT id, seller_id, company_name, COALESCE(total_value, 0) AS total_value,
            COALESCE(total_contracts, 0)::int AS total_contracts
     FROM new_seller_details
     WHERE id = $1`,
    [sellerId]
  );
  if (!sellerRes.rows[0]) {
    throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);
  }

  // 2. Authorization check
  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      `SELECT 1 FROM seller_end_users WHERE seller_id = $1 AND end_user_id = $2`,
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  } else if (req.user && req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [sellerId, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  // 3. Query state-wise contract amounts and counts
  const query = `
    SELECT
      s.id AS state_id,
      COALESCE(s.name, 'Unknown (Unspecified Location)') AS state_name,
      s.gst_code,
      COUNT(c.id)::int AS contract_count,
      COALESCE(SUM(c.total_value), 0)::numeric AS total_amount
    FROM new_contracts c
    LEFT JOIN states s ON s.id = c.state_id
    WHERE c.seller_id = $1
    GROUP BY s.id, s.name, s.gst_code
    ORDER BY total_amount DESC, contract_count DESC, state_name ASC
  `;

  const { rows } = await db.query(query, [sellerId]);

  let totalValue = 0;
  let totalContracts = 0;
  let minAmount = 0;
  let maxAmount = 0;

  for (const row of rows) {
    const amount = Number(row.total_amount) || 0;
    totalValue += amount;
    totalContracts += row.contract_count;
    if (amount > 0) {
      if (minAmount === 0 || amount < minAmount) minAmount = amount;
      if (amount > maxAmount) maxAmount = amount;
    }
  }

  const states = rows.map((r) => {
    const amount = Number(r.total_amount) || 0;
    const percentage = totalValue > 0 ? Number(((amount / totalValue) * 100).toFixed(1)) : 0;
    return {
      state_id: r.state_id,
      state_name: r.state_name,
      gst_code: r.gst_code,
      contract_count: r.contract_count,
      total_amount: amount,
      percentage,
    };
  });

  return res.status(200).json({
    seller_id: sellerId,
    company_name: sellerRes.rows[0].company_name,
    total_value: totalValue,
    total_contracts: totalContracts,
    states_count: states.length,
    min_amount: minAmount,
    max_amount: maxAmount,
    states,
  });
};
