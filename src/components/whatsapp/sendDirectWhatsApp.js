const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const WhatsApp = require('@/service/whatsapp');
const { toWhatsAppDestination } = require('@/service/whatsapp/extractPhones');

exports.validationSchema = {
  body: Joi.object({
    company_name: Joi.string().trim().min(1).max(255).required(),
    phone_number: Joi.string().trim().min(8).max(32).required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send WhatsApp message', 401, ErrorCode.UNAUTHORIZED);
  }

  const companyName = String(req.body.company_name || '').trim();
  const destination = toWhatsAppDestination(req.body.phone_number);

  if (!destination) {
    throw new ServerError(
      'Enter a valid 10-digit Indian mobile number (starting with 6–9)',
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

  const digits = destination.slice(-10);
  const seller = await db.query(
    `
    SELECT sd.id, sd.seller_id, sd.company_name
    FROM new_seller_information si
    JOIN new_seller_details sd ON sd.id = si.seller_id
    WHERE public.seller_mobile_digits(si.phone) = $1
    ORDER BY si.id
    LIMIT 1
    `,
    [digits]
  );
  const matched = seller.rows[0] || null;
  const userName = companyName || String(matched?.company_name || '').trim() || 'Seller';
  const templateCampaign = whatsappConfig.campaignName || 'T1';

  const sendResult = await WhatsApp.sendCampaignMessage(destination, {
    userName,
    campaignName: templateCampaign,
    source: 'whatsapp-direct',
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
  const { rows } = await db.query(
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
    VALUES ($1, $2, $3, $4, $5, $6, 'whatsapp-direct', $7::jsonb, $8)
    RETURNING id, seller_id, gem_seller_id, company_name, destination, phone, campaign_name, sent_at
    `,
    [
      matched?.id || null,
      matched?.seller_id || null,
      userName.slice(0, 255),
      resolvedDestination,
      resolvedDestination,
      sendResult.campaignName || templateCampaign,
      JSON.stringify(sendResult.data ?? {}),
      req.user.id,
    ]
  );

  return res.status(201).json({
    message: 'WhatsApp message sent successfully',
    company_name: userName,
    phone_number: resolvedDestination,
    campaign_name: sendResult.campaignName || templateCampaign,
    seller_id: matched?.id || null,
    whatsapp_log: rows[0] || null,
  });
};
