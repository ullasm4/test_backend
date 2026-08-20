const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Mail = require('@/service/mail');
const { assertSellerMailSendAllowed } = require('@/service/mail/mailSendLimits');
const { PRIMARY_SELLER_CONTACT } = require('@/lib/newTableSql');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    subject: Joi.string().trim().min(1).max(255).optional().allow(''),
    message: Joi.string().trim().min(1).max(10000).optional().allow(''),
  }),
};

async function loadSellerCategories(db, gemSellerId, sellerUuid) {
  let categories = [];

  if (gemSellerId) {
    const catRes = await db.query(
      `SELECT category FROM seller_category WHERE seller_id = $1 ORDER BY category ASC`,
      [gemSellerId]
    );
    categories = catRes.rows.map((r) => r.category).filter(Boolean);
  }

  if (categories.length === 0 && sellerUuid) {
    const fallbackRes = await db.query(
      `SELECT DISTINCT TRIM(REGEXP_REPLACE(elem->>'category', '^Category Name\\s*(&\\s*Quadrant)?\\s*:\\s*', '', 'i')) AS category
       FROM new_contracts c, jsonb_array_elements(c.products) AS elem
       WHERE c.seller_id = $1
         AND jsonb_typeof(c.products) = 'array'
         AND elem->>'category' IS NOT NULL
         AND TRIM(elem->>'category') <> ''
       ORDER BY category ASC`,
      [sellerUuid]
    );
    categories = fallbackRes.rows
      .map((r) => r.category)
      .filter(
        (c) =>
          c &&
          !['category name & quadrant', 'category name', 'category'].includes(
            String(c).toLowerCase()
          )
      );
  }

  return categories;
}

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const sellerId = req.params.id;
  const subjectInput = String(req.body.subject || '').trim();
  const messageInput = String(req.body.message || '').trim();

  const sellerRes = await db.query(
    `
    SELECT
      sd.id AS seller_uuid,
      sd.seller_id AS gem_seller_id,
      sd.company_name,
      si.email
    FROM new_seller_details sd
    ${PRIMARY_SELLER_CONTACT}
    WHERE sd.id = $1
    `,
    [sellerId]
  );

  const seller = sellerRes.rows[0];
  if (!seller) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  const to = String(seller.email || '').trim().toLowerCase();
  if (!to) {
    throw new ServerError(
      'This seller does not have an email address. Add email first.',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const cooldown = await assertSellerMailSendAllowed(db, {
    sellerId: seller.seller_uuid,
    email: to,
  });

  const companyName = String(seller.company_name || seller.gem_seller_id || 'Seller').trim();
  const categoryLabels = await loadSellerCategories(
    db,
    seller.gem_seller_id,
    seller.seller_uuid
  );

  const defaultTemplate = Mail.DEFAULT_TEMPLATE;
  const template = Mail.buildBrandOutreachMail({
    brandLabel: companyName,
    categoryLabels,
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
          categories: categoryLabels,
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
      missing_body: 'Email message is required',
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
      seller.seller_uuid,
      seller.gem_seller_id || null,
      (companyName || '').slice(0, 255),
      to,
      subject,
      JSON.stringify({
        message: body,
        mail_type: template.mailType || Mail.DEFAULT_MAIL_TYPE,
      }),
      req.user.id,
    ]
  );

  await db.query(
    `
    UPDATE new_seller_details
    SET
      email_sent = TRUE,
      email_sent_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [seller.seller_uuid]
  );

  return res.status(201).json({
    message: 'Email sent successfully',
    seller_id: seller.seller_uuid,
    to,
    subject,
    message_id: sendResult.messageId || null,
    mail_cooldown: {
      ...cooldown,
      allowed: false,
      last_sent_at: new Date().toISOString(),
      next_allowed_at: new Date(
        Date.now() + cooldown.cooldown_days * 24 * 60 * 60 * 1000
      ).toISOString(),
    },
  });
};
