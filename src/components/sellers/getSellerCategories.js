const Joi = require('joi');
const { fetchSellerCategories } = require('@/lib/sellerCategories');

exports.validationSchema = {
  params: Joi.object({
    id: Joi.string().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const paramId = req.params.id;

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

  const categories = await fetchSellerCategories(db, {
    sellerUuid,
    gemSellerId,
  });

  return res.status(200).json({
    seller_id: gemSellerId,
    total_categories: categories.length,
    categories,
  });
};
