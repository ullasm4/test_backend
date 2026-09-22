const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const {
  MAX_BULK_LIMIT,
  previewEligibleBulkSellers,
} = require('@/lib/brevoBulkSellers');
const {
  brevoBulkSellerFiltersQuerySchema,
  pickSellerBulkFilters,
} = require('@/lib/brevoBulkFilterSchema');

exports.validationSchema = {
  query: brevoBulkSellerFiltersQuerySchema,
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required', 401, ErrorCode.UNAUTHORIZED);
  }

  const isAdmin = req.user.role === 'admin';
  const query = req.customQuery || req.query || {};
  const requestedLimit = Number(query.limit || 0);
  const safeLimit = Math.min(Math.max(requestedLimit, 1), MAX_BULK_LIMIT);
  const filters = pickSellerBulkFilters(query);

  const { eligible_total: eligibleTotal, will_send: willSend } = await previewEligibleBulkSellers(
    db,
    {
      userId: req.user.id,
      isAdmin,
      limit: safeLimit,
      filters,
    }
  );

  return res.status(200).json({
    requested_limit: safeLimit,
    will_send: willSend,
    eligible_total: eligibleTotal,
    // Bulk is once-only; field kept for API compatibility (ignored by clients).
    cooldown_days: 0,
    once_only: true,
    max_bulk_limit: MAX_BULK_LIMIT,
  });
};
