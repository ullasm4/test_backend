const Joi = require('joi');
const Schema = require('@/config/validationSchema');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { PRIMARY_SELLER_CONTACT, LATEST_SELLER_CONTRACT } = require('@/lib/newTableSql');
const { getSellerMailCooldown } = require('@/service/mail/mailSendLimits');
const { getSellerWhatsAppCooldown } = require('@/service/whatsapp/whatsappSendLimits');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const [sellerRes, contactsRes] = await Promise.all([
    db.query(
      `SELECT
         sd.id,
         sd.seller_id,
         sd.company_name,
         sd.msme_certificate_number,
         COALESCE(sd.total_value, 0) AS total_value,
         COALESCE(sd.total_contracts, 0)::int AS total_contracts,
         sd.email_sent,
         sd.email_sent_at,
         sd.whatsapp_sent,
         sd.whatsapp_sent_at,
         si.phone,
         si.email,
         si.address,
         si.gst_number,
         (si.phone IS NOT NULL AND BTRIM(si.phone) <> '') AS is_mobile,
         (si.email IS NOT NULL AND BTRIM(si.email) <> '') AS is_email,
         lc.contract_id,
         lc.contract_number,
         lc.status_of_the_contract
       FROM new_seller_details sd
       ${PRIMARY_SELLER_CONTACT}
       ${LATEST_SELLER_CONTRACT}
       WHERE sd.id = $1`,
      [req.params.id]
    ),
    db.query(
      `SELECT id, phone, email, address, gst_number
       FROM new_seller_information
       WHERE seller_id = $1
       ORDER BY
         (phone IS NOT NULL AND BTRIM(phone) <> '') DESC,
         (email IS NOT NULL AND BTRIM(email) <> '') DESC,
         id`,
      [req.params.id]
    ),
  ]);

  if (!sellerRes.rows[0]) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  if (req.user && req.user.role !== 'admin') {
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
