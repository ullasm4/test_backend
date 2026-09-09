const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { PRIMARY_SELLER_CONTACT, LATEST_SELLER_CONTRACT } = require('@/lib/newTableSql');
const { getLeadStatusSchema, sellerStatusSelectSql } = require('@/lib/leadStatusSchema');
const { getSellerMailCooldown } = require('@/service/mail/mailSendLimits');
const { getSellerWhatsAppCooldown } = require('@/service/whatsapp/whatsappSendLimits');
const { isEndUser } = require('@/middleware/auth');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const leadSchema = await getLeadStatusSchema(db);
  const statusSelect = sellerStatusSelectSql(leadSchema.sellerStatus);

  const [sellerRes, contactsRes] = await Promise.all([
    db.query(
      `SELECT
         sd.id,
         sd.seller_id,
         sd.company_name,
         sd.msme_certificate_number,
         sd.type,
         ${statusSelect},
         COALESCE(sd.total_value, 0) AS total_value,
         COALESCE(sd.total_contracts, 0)::int AS total_contracts,
         sd.email_sent,
         sd.email_sent_at,
         sd.whatsapp_sent,
         sd.whatsapp_sent_at,
         si.phone,
         si.email,
         si.address,
         si.city_id,
         si.city,
         si.gst_number,
         (si.phone IS NOT NULL AND BTRIM(si.phone) <> '') AS is_mobile,
         (si.email IS NOT NULL AND BTRIM(si.email) <> '') AS is_email,
         lc.contract_id,
         lc.contract_number,
         lc.status_of_the_contract,
         uas.user_id AS assigned_user_id,
         u.name AS assigned_user_name
       FROM new_seller_details sd
       ${PRIMARY_SELLER_CONTACT}
       ${LATEST_SELLER_CONTRACT}
       LEFT JOIN user_assign_sellers uas ON uas.seller_id = sd.id
       LEFT JOIN users u ON u.id = uas.user_id
       WHERE sd.id = $1`,
      [req.params.id]
    ),
    db.query(
      `SELECT si.id, si.phone, si.email, si.address, si.city_id, c.name AS city, si.gst_number
       FROM new_seller_information si
       LEFT JOIN cities c ON c.id = si.city_id
       WHERE si.seller_id = $1
       ORDER BY
         (si.phone IS NOT NULL AND BTRIM(si.phone) <> '') DESC,
         (si.email IS NOT NULL AND BTRIM(si.email) <> '') DESC,
         si.id`,
      [req.params.id]
    ),
  ]);

  if (!sellerRes.rows[0]) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  if (isEndUser(req.user)) {
    const checkRes = await db.query(
      `SELECT 1 FROM seller_end_users WHERE seller_id = $1 AND end_user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  } else if (req.user && req.user.role !== 'admin') {
    const checkRes = await db.query(
      `SELECT 1 FROM user_assign_sellers WHERE seller_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!checkRes.rows[0]) {
      throw new ServerError('Seller not assigned to user', 403, ErrorCode.FORBIDDEN);
    }
  }

  const seller = sellerRes.rows[0];
  const [mailCooldown, whatsappCooldown] = await Promise.all([
    getSellerMailCooldown(db, {
      sellerId: seller.id,
      email: seller.email,
    }),
    getSellerWhatsAppCooldown(db, {
      sellerId: seller.id,
      phone: seller.phone,
    }),
  ]);

  return res.status(200).json({
    ...seller,
    total_contracts_count: seller.total_contracts,
    total_contracts_value: parseFloat(seller.total_value) || 0,
    contacts: contactsRes.rows,
    mail_cooldown: mailCooldown,
    whatsapp_cooldown: whatsappCooldown,
  });
};
