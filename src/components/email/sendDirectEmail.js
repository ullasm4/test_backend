const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Mail = require('@/service/mail');
const {
  DIRECT_MAIL_COOLDOWN_DAYS,
  assertDirectMailSendAllowed,
} = require('@/service/mail/mailSendLimits');

exports.validationSchema = {
  body: Joi.object({
    email: Joi.string().trim().email({ tlds: { allow: false } }).max(255).required(),
    company_name: Joi.string().trim().min(1).max(255).optional().allow(''),
    subject: Joi.string().trim().min(1).max(255).optional().allow(''),
    message: Joi.string().trim().min(1).max(10000).optional().allow(''),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const to = String(req.body.email || '').trim().toLowerCase();
  const subjectInput = String(req.body.subject || '').trim();
  const messageInput = String(req.body.message || '').trim();

  const matchedSellerRes = await db.query(
    `
    SELECT
      sd.id AS seller_uuid,
      sd.seller_id AS gem_seller_id,
      sd.company_name
    FROM new_seller_information si
    JOIN new_seller_details sd ON sd.id = si.seller_id
    WHERE LOWER(BTRIM(si.email)) = $1
    ORDER BY sd.id DESC
    LIMIT 1
    `,
    [to]
  );
  const matched = matchedSellerRes.rows[0] || null;

  const cooldown = await assertDirectMailSendAllowed(db, {
    sellerId: matched?.seller_uuid || null,
    email: to,
  });

  const companyName =
    String(req.body.company_name || '').trim() ||
    String(matched?.company_name || '').trim() ||
    to.split('@')[0] ||
    'your company';

  const defaultTemplate = Mail.DEFAULT_TEMPLATE;
  const template = Mail.buildBrandOutreachMail({
    brandLabel: companyName,
    companyName,
    template: defaultTemplate,
  });

  const subject = subjectInput || template.subject;
  const body = messageInput || template.body;
  const html = messageInput
    ? Mail.buildBrandOutreachHtml(
        Mail.replacePlaceholders(messageInput, {
          company: companyName,
          brand: companyName,
          sender_name: defaultTemplate.sender_name,
          sender_website: defaultTemplate.sender_website,
        }),
        { website: defaultTemplate.sender_website }
      )
    : template.html;

  const sendResult = await Mail.send({
    to,
    subject,
    html,
    text: body,
    attachments: template.attachments || [],
  });

  if (!sendResult.success) {
    const reasonMessages = {
      missing_recipient: 'Recipient email is required',
      missing_subject: 'Email subject is required',
      missing_body: 'Email body is required',
      config: 'Email is not configured. Set EMAIL_USER and GMAIL_SERVICE_ACCOUNT_KEY in backend/.env',
      transport: sendResult.message || 'Failed to send email',
      daily_limit: 'Gmail daily sending limit exceeded. Try again tomorrow.',
    };
    throw new ServerError(
      reasonMessages[sendResult.reason] || sendResult.message || 'Failed to send email',
      sendResult.reason === 'config' || sendResult.reason === 'daily_limit' ? 400 : 500,
      sendResult.reason === 'config' || sendResult.reason === 'daily_limit'
        ? ErrorCode.BAD_REQUEST
        : ErrorCode.INTERNAL
    );
  }

  try {
    await db.query(
      `
      INSERT INTO seller_email_log (
        seller_id,
        gem_seller_id,
        company_name,
        email,
        subject,
        source,
        response_payload,
        sent_by
      )
      VALUES ($1, $2, $3, $4, $5, 'email-direct', $6::jsonb, $7)
      `,
      [
        matched?.seller_uuid || null,
        matched?.gem_seller_id || null,
        (companyName || '').slice(0, 255),
        to,
        subject,
        JSON.stringify({
          message: body,
          mail_type: template.mailType || Mail.DEFAULT_MAIL_TYPE,
          message_id: sendResult.messageId || null,
        }),
        req.user.id,
      ]
    );

    if (matched?.seller_uuid) {
      await db.query(
        `
        UPDATE new_seller_details
        SET
          email_sent = TRUE,
          email_sent_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [matched.seller_uuid]
      );
    }
  } catch (logError) {
    console.warn('Email sent but failed to write seller_email_log', {
      email: to,
      message: logError?.message,
    });
  }

  return res.status(201).json({
    message: 'Email sent successfully',
    company_name: companyName,
    email: to,
    subject,
    seller_id: matched?.seller_uuid || null,
    message_id: sendResult.messageId || null,
    mail_cooldown: {
      ...cooldown,
      allowed: false,
      last_sent_at: new Date().toISOString(),
      next_allowed_at: new Date(
        Date.now() + DIRECT_MAIL_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      cooldown_days: DIRECT_MAIL_COOLDOWN_DAYS,
    },
  });
};
