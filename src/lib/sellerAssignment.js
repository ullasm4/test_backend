const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

async function isSellerAssignedToUser(db, sellerId, userId) {
  if (!sellerId || !userId) return false;

  const result = await db.query(
    `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
    [String(sellerId).trim(), String(userId).trim()]
  );

  return Boolean(result.rows[0]);
}

async function assertSellerAssignedToUser(db, sellerId, userId) {
  const assigned = await isSellerAssignedToUser(db, sellerId, userId);
  if (!assigned) {
    throw new ServerError('Seller is not assigned to you', 403, ErrorCode.FORBIDDEN);
  }
}

module.exports = {
  isSellerAssignedToUser,
  assertSellerAssignedToUser,
};
