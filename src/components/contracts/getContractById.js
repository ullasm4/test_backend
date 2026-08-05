const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { enrichContract } = require('@/lib/contractHelpers');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT c.*, m.name AS ministry_name
     FROM contracts c
     LEFT JOIN contract_ministry m ON m.id = c.ministry_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) throw new ServerError('Contract not found', 404, ErrorCode.NOT_FOUND);

  const contract = enrichContract(rows[0]);
  delete contract.full_html;

  const [sellers, buyers] = await Promise.all([
    db.query('SELECT * FROM sellers WHERE contract_id = $1 ORDER BY created_at', [req.params.id]),
    db.query('SELECT * FROM buyers WHERE contract_id = $1 ORDER BY created_at', [req.params.id]),
  ]);

  return res.status(200).json({
    ...contract,
    sellers: sellers.rows,
    buyers: buyers.rows,
  });
};
