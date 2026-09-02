async function loadSellerForBrevo(db, { sellerId, email }) {
  if (sellerId) {
    const sellerRes = await db.query(
      `
      SELECT
        sd.id AS seller_uuid,
        sd.seller_id AS gem_seller_id,
        sd.company_name,
        COALESCE(sd.total_value, 0) AS total_value,
        si.email
      FROM new_seller_details sd
      LEFT JOIN LATERAL (
        SELECT email
        FROM new_seller_information
        WHERE seller_id = sd.id
          AND email IS NOT NULL
          AND BTRIM(email) <> ''
        ORDER BY id
        LIMIT 1
      ) si ON TRUE
      WHERE sd.id = $1
      LIMIT 1
      `,
      [sellerId]
    );
    if (sellerRes.rows[0]) return sellerRes.rows[0];
  }

  if (!email) return null;

  const matchedSellerRes = await db.query(
    `
    SELECT
      sd.id AS seller_uuid,
      sd.seller_id AS gem_seller_id,
      sd.company_name,
      COALESCE(sd.total_value, 0) AS total_value,
      si.email
    FROM new_seller_information si
    JOIN new_seller_details sd ON sd.id = si.seller_id
    WHERE LOWER(BTRIM(si.email)) = $1
    ORDER BY sd.id DESC
    LIMIT 1
    `,
    [email]
  );

  return matchedSellerRes.rows[0] || null;
}

module.exports = {
  loadSellerForBrevo,
};
