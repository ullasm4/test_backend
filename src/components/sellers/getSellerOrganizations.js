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

  // 3. Query organization-wise contract amounts, counts, and states count
  const query = `
    SELECT
      COALESCE(NULLIF(TRIM(c.org_name), ''), 'Unknown Organization') AS org_name,
      COUNT(c.id)::int AS contract_count,
      COALESCE(SUM(c.total_value), 0)::numeric AS total_amount,
      COUNT(DISTINCT c.state_id)::int AS states_count
    FROM new_contracts c
    WHERE c.seller_id = $1
    GROUP BY COALESCE(NULLIF(TRIM(c.org_name), ''), 'Unknown Organization')
    ORDER BY total_amount DESC, contract_count DESC, org_name ASC
  `;

  // Total distinct states for this seller
  const statesQuery = `
    SELECT COUNT(DISTINCT state_id)::int AS total_states
    FROM new_contracts
    WHERE seller_id = $1 AND state_id IS NOT NULL
  `;

  const [{ rows }, statesRes] = await Promise.all([
    db.query(query, [sellerId]),
    db.query(statesQuery, [sellerId]),
  ]);

  let totalValue = 0;
  let totalContracts = 0;

  for (const row of rows) {
    const amount = Number(row.total_amount) || 0;
    totalValue += amount;
    totalContracts += row.contract_count;
  }

  const organizations = rows.map((r) => {
    const amount = Number(r.total_amount) || 0;
    const percentage = totalValue > 0 ? Number(((amount / totalValue) * 100).toFixed(1)) : 0;
    return {
      org_name: r.org_name,
      contract_count: r.contract_count,
      total_amount: amount,
      percentage,
      states_count: r.states_count,
    };
  });

  const totalStates = statesRes.rows[0]?.total_states || 0;

  return res.status(200).json({
    seller_id: sellerId,
    company_name: sellerRes.rows[0].company_name,
    total_value: totalValue,
    total_contracts: totalContracts,
    total_organizations: organizations.length,
    total_states: totalStates,
    organizations,
  });
};
