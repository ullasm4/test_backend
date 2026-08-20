const { HAS_EMAIL_SQL } = require('@/lib/newTableSql');

exports.validationSchema = {};

exports.controller = async (_req, res, _next, db) => {
  const [sellersRes, totalsRes, todayRes, lastRes] = await Promise.all([
    db.query(
      `
      SELECT COUNT(*)::int AS total
      FROM new_seller_details sd
      WHERE ${HAS_EMAIL_SQL}
      `
    ),
    db.query(
      `
      SELECT
        COUNT(*)::int AS total_emails_sent,
        COUNT(DISTINCT LOWER(BTRIM(email)))::int AS unique_emails
      FROM seller_email_log
      `
    ),
    db.query(
      `
      SELECT COUNT(*)::int AS sent_today
      FROM seller_email_log
      WHERE sent_at >= CURRENT_DATE
        AND sent_at < CURRENT_DATE + INTERVAL '1 day'
      `
    ),
    db.query(
      `
      SELECT email, company_name, sent_at, subject, source
      FROM seller_email_log
      ORDER BY sent_at DESC
      LIMIT 1
      `
    ),
  ]);

  const last = lastRes.rows[0] || null;

  return res.status(200).json({
    sellers_with_email: sellersRes.rows[0]?.total || 0,
    total_emails_sent: totalsRes.rows[0]?.total_emails_sent || 0,
    unique_emails: totalsRes.rows[0]?.unique_emails || 0,
    sent_today: todayRes.rows[0]?.sent_today || 0,
    last_email: last?.email || null,
    last_company_name: last?.company_name || null,
    last_sent_at: last?.sent_at || null,
    last_subject: last?.subject || null,
    last_source: last?.source || null,
  });
};
