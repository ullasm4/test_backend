async function fetchSellerCategories(db, { sellerUuid, gemSellerId }) {
  const ids = [...new Set([sellerUuid, gemSellerId].filter(Boolean).map(String))];
  for (const sellerId of ids) {
    const { rows } = await db.query(
      `SELECT category
       FROM seller_category
       WHERE seller_id = $1
       ORDER BY category ASC`,
      [sellerId]
    );
    if (rows.length) return rows.map((row) => row.category);
  }
  return [];
}

module.exports = {
  fetchSellerCategories,
};
