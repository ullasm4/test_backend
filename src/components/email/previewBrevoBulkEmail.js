const Joi = require('joi');
const {
  MAX_BULK_LIMIT,
  SELLER_MAIL_COOLDOWN_DAYS,
  countEligibleBulkSellersUpTo,
} = require('@/lib/brevoBulkSellers');

exports.validationSchema = {
  query: Joi.object({
    limit: Joi.number().integer().min(1).max(MAX_BULK_LIMIT).required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const isAdmin = req.user?.role === 'admin';
  const requestedLimit = Number(req.customQuery?.limit || req.query?.limit || 0);
  const safeLimit = Math.min(Math.max(requestedLimit, 1), MAX_BULK_LIMIT);

  const willSend = await countEligibleBulkSellersUpTo(db, {
    userId: req.user.id,
    isAdmin,
    limit: safeLimit,
  });

  return res.status(200).json({
    requested_limit: safeLimit,
    will_send: willSend,
    cooldown_days: SELLER_MAIL_COOLDOWN_DAYS,
    max_bulk_limit: MAX_BULK_LIMIT,
  });
};
