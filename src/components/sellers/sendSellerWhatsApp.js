const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const WhatsApp = require('@/service/whatsapp');
const { assertSellerWhatsAppSendAllowed } = require('@/service/whatsapp/whatsappSendLimits');
const { PRIMARY_SELLER_CONTACT } = require('@/lib/newTableSql');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({}).unknown(false),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send WhatsApp message', 401, ErrorCode.UNAUTHORIZED);
  }

  const sellerId = req.params.id;

  const sellerRes = await db.query(
    `
    SELECT
      sd.id AS seller_uuid,
      sd.seller_id AS gem_seller_id,
      sd.company_name,
      si.phone
    FROM new_seller_details sd
    ${PRIMARY_SELLER_CONTACT}
    WHERE sd.id = $1
    `,
    [sellerId]
  );

  const seller = sellerRes.rows[0];
  if (!seller) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  const destination = WhatsApp.toWhatsAppDestination(seller.phone);
  if (!destination) {
    throw new ServerError(
      'This seller does not have a valid WhatsApp phone number. Add a 10-digit Indian mobile first.',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const whatsappConfig = WhatsApp.getConfig();
  if (!whatsappConfig.apiKey) {
    throw new ServerError(
      'WhatsApp is not configured. Set WHATSAPP_SERVICE_API_KEY in backend/.env',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const cooldown = await assertSellerWhatsAppSendAllowed(db, {
    sellerId: seller.seller_uuid,
    phone: seller.phone,
  });

  const companyName = String(seller.company_name || seller.gem_seller_id || 'Seller').trim();
  const templateCampaign = whatsappConfig.campaignName || 'T1';

  const sendResult = await WhatsApp.sendCampaignMessage(destination, {
    userName: companyName,
    campaignName: templateCampaign,
    source: 'whatsapp-bulk',
  });

  if (!sendResult.success) {
    const reasonMessages = {
      config: 'WhatsApp is not configured. Set WHATSAPP_SERVICE_API_KEY.',
      invalid_destination: 'Invalid WhatsApp destination phone number.',
      missing_user_name: 'Company name is required to send WhatsApp message.',
      api_error: sendResult.message || 'AiSensy API rejected the request.',
      transport: sendResult.message || 'Failed to reach AiSensy API.',
    };

    throw new ServerError(
      reasonMessages[sendResult.reason] || sendResult.message || 'Failed to send WhatsApp message',
      sendResult.reason === 'config'
        || sendResult.reason === 'invalid_destination'
        || sendResult.reason === 'missing_user_name'
        ? 400
        : 500,
      sendResult.reason === 'config'
        || sendResult.reason === 'invalid_destination'
        || sendResult.reason === 'missing_user_name'
        ? ErrorCode.BAD_REQUEST
        : ErrorCode.INTERNAL
    );
  }

  const resolvedDestination = sendResult.destination || destination;

  await db.query(
    `
    INSERT INTO seller_whatsapp_log (
      seller_id,
      gem_seller_id,
      company_name,
      destination,
      phone,
      campaign_name,
      source,
      response_payload,
      sent_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'whatsapp-bulk', $7::jsonb, $8)
    `,
    [
      seller.seller_uuid,
      seller.gem_seller_id || null,
      companyName.slice(0, 255),
      resolvedDestination,
      resolvedDestination,
      sendResult.campaignName || templateCampaign,
      JSON.stringify(sendResult.data ?? {}),
      req.user.id,
    ]
  );

  await db.query(
    `
    UPDATE new_seller_details
    SET
      whatsapp_sent = TRUE,
      whatsapp_sent_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [seller.seller_uuid]
  );

  return res.status(201).json({
    message: 'WhatsApp message sent successfully',
    seller_id: seller.seller_uuid,
    phone_number: resolvedDestination,
    company_name: companyName,
    campaign_name: sendResult.campaignName || templateCampaign,
    whatsapp_cooldown: {
      ...cooldown,
      allowed: false,
      last_sent_at: new Date().toISOString(),
      next_allowed_at: new Date(
        Date.now() + cooldown.cooldown_days * 24 * 60 * 60 * 1000
      ).toISOString(),
    },
  });
};
