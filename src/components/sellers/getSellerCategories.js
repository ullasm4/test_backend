const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const { fetchSellerCategoriesPage } = require('@/lib/sellerCategories');

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;

exports.validationSchema = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
  query: Joi.object({
    page: Schema.pagination.page(),
    limit: Schema.pagination.limit(MAX_LIMIT).default(DEFAULT_LIMIT),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const paramId = req.params.id;
  const page = req.customQuery.page || 1;
  const limit = req.customQuery.limit || DEFAULT_LIMIT;
  const offset = (page - 1) * limit;

  const sellerRes = await db.query(
    `SELECT id, seller_id
     FROM new_seller_details
     WHERE id::text = $1 OR seller_id = $1
     LIMIT 1`,
    [paramId]
  );

  const seller = sellerRes.rows[0];
  const gemSellerId = seller?.seller_id || paramId;
  const sellerUuid = seller?.id || null;

  const { total, categories } = await fetchSellerCategoriesPage(db, {
    sellerUuid,
    gemSellerId,
    limit,
    offset,
  });

  return res.status(200).json({
    seller_id: gemSellerId,
    total_categories: total,
    total,
    page,
    limit,
    offset,
    categories,
  });
};
