exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const { rows } = await db.query(
    `SELECT m.id, m.name, COUNT(c.id)::int AS contract_count
     FROM contract_ministry m
     LEFT JOIN contracts c ON c.ministry_id = m.id
     GROUP BY m.id, m.name
     ORDER BY m.name ASC`
  );
  return res.status(200).json({ data: rows });
};
