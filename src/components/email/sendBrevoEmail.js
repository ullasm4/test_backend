const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Mail = require('@/service/mail');
const { sendTransactionalEmail } = require('@/service/mail/brevoService');
const { normalizeMessageId } = require('@/lib/messageId');
const { loadUserMailSender } = require('@/lib/userMailSender');

exports.validationSchema = {
  body: Joi.object({
    to: Joi.string().trim().email({ tlds: { allow: false } }).max(255).required(),
    company_name: Joi.string().trim().min(1).max(255).optional().allow(''),
    subject: Joi.string().trim().min(1).max(255).optional().allow(''),
    htmlContent: Joi.string().trim().min(1).max(50000).optional().allow(''),
    template_id: Joi.number().integer().positive().optional().allow(null, ''),
    templateId: Joi.number().integer().positive().optional().allow(null, ''),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const sender = await loadUserMailSender(db, req.user.id);

  const to = String(req.body.to || '').trim().toLowerCase();
  const subjectInput = String(req.body.subject || '').trim();
  const htmlInput = String(req.body.htmlContent || '').trim();
  const companyInput = String(req.body.company_name || '').trim();
  const templateId = req.body.template_id || req.body.templateId || null;

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

  const companyName =
    companyInput ||
    String(matched?.company_name || '').trim() ||
    to.split('@')[0] ||
    'your company';

  const defaultTemplate = Mail.DEFAULT_TEMPLATE;
  const brandMail = Mail.buildBrandOutreachMail({
    brandLabel: companyName,
    companyName,
    template: defaultTemplate,
  });

  const finalSubject = subjectInput || brandMail.subject;
  const finalHtmlContent = htmlInput
    ? Mail.buildBrandOutreachHtml(
        Mail.replacePlaceholders(htmlInput, {
          company: companyName,
          brand: companyName,
          sender_name: sender.name,
          sender_website: defaultTemplate.sender_website,
        }),
        { website: defaultTemplate.sender_website }
      )
    : brandMail.html;

  const sendResult = await sendTransactionalEmail({
    to,
    subject: finalSubject,
    htmlContent: finalHtmlContent,
    templateId: templateId ? Number(templateId) : undefined,
    templateParams: {
      COMPANY_NAME: companyName,
      RECIPIENT_EMAIL: to,
      SUBJECT: finalSubject,
    },
    senderEmail: sender.email,
    senderName: sender.name,
    replyTo: sender.email,
  });

  const messageId = normalizeMessageId(sendResult.messageId);

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
      VALUES ($1, $2, $3, $4, $5, 'brevo-email', $6::jsonb, $7)
      `,
      [
        matched?.seller_uuid || null,
        matched?.gem_seller_id || null,
        companyName.slice(0, 255),
        to,
        finalSubject,
        JSON.stringify({
          message: finalHtmlContent,
          provider: 'brevo',
          template_id: templateId || null,
          message_id: messageId,
          sender_email: sender.email,
          sender_name: sender.name,
        }),
        sender.id,
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
    console.warn('Brevo email sent but failed to update seller_email_log:', {
      email: to,
      message: logError?.message,
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Email sent successfully via Brevo',
    to,
    company_name: companyName,
    subject: finalSubject,
    template_id: templateId || null,
    seller_id: matched?.seller_uuid || null,
    messageId: messageId || null,
    from_email: sender.email,
    from_name: sender.name,
  });
};
