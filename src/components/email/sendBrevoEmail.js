const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Schema = require('@/config/validationSchema');
const Mail = require('@/service/mail');
const { sendTransactionalEmail } = require('@/service/mail/brevoService');
const { normalizeMessageId } = require('@/lib/messageId');
const { loadUserMailSender } = require('@/lib/userMailSender');
const { loadSellerForBrevo } = require('@/lib/brevoSellerLookup');
const { fetchSellerCategories } = require('@/lib/sellerCategories');
const { buildBrevoTemplateParams, getDefaultSubjectForTemplate } = require('@/lib/brevoTemplateParams');
const { getBrevoTemplateById } = require('@/config/brevoTemplates');

function assertSellerOutreachRequirements({ sender, companyInput, matched }) {
  if (!String(sender.name || '').trim()) {
    throw new ServerError(
      'Your profile name is required to send Seller Outreach template (person_name)',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  if (!String(sender.phone || '').trim()) {
    throw new ServerError(
      'Your profile phone is required to send Seller Outreach template (person_phone)',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  if (!String(companyInput || matched?.company_name || '').trim()) {
    throw new ServerError(
      'Company name is required for Seller Outreach template (company_name)',
      400,
      ErrorCode.BAD_REQUEST
    );
  }
}

function pickSellerOutreachOverrides(body = {}) {
  const direct = body.template_params && typeof body.template_params === 'object' ? body.template_params : {};
  const keys = ['company_name', 'total_contract_value', 'categories', 'person_name', 'person_phone'];
  const picked = {};

  for (const key of keys) {
    const value = String(direct[key] ?? body[key] ?? '').trim();
    if (value) picked[key] = value;
  }

  return picked;
}

function hasCompleteSellerOutreachOverrides(overrides) {
  return ['company_name', 'total_contract_value', 'categories', 'person_name', 'person_phone'].every(
    (key) => String(overrides[key] || '').trim()
  );
}

exports.validationSchema = {
  body: Joi.object({
    to: Joi.string().trim().email({ tlds: { allow: false } }).max(255).required(),
    seller_id: Schema.uuid().optional().allow(null, ''),
    company_name: Joi.string().trim().min(1).max(255).optional().allow(''),
    total_contract_value: Joi.string().trim().max(255).optional().allow(''),
    categories: Joi.string().trim().max(5000).optional().allow(''),
    person_name: Joi.string().trim().max(255).optional().allow(''),
    person_phone: Joi.string().trim().max(50).optional().allow(''),
    template_params: Joi.object({
      company_name: Joi.string().trim().max(255).optional().allow(''),
      total_contract_value: Joi.string().trim().max(255).optional().allow(''),
      categories: Joi.string().trim().max(5000).optional().allow(''),
      person_name: Joi.string().trim().max(255).optional().allow(''),
      person_phone: Joi.string().trim().max(50).optional().allow(''),
    }).optional(),
    subject: Joi.string().trim().min(1).max(255).optional().allow(''),
    htmlContent: Joi.string().trim().min(1).max(50000).optional().allow(''),
    template_id: Joi.number().integer().positive().required(),
    templateId: Joi.number().integer().positive().optional(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const sender = await loadUserMailSender(db, req.user.id);

  const to = String(req.body.to || '').trim().toLowerCase();
  const sellerIdInput = String(req.body.seller_id || '').trim() || null;
  const subjectInput = String(req.body.subject || '').trim();
  const htmlInput = String(req.body.htmlContent || '').trim();
  const companyInput = String(req.body.company_name || '').trim();
  const outreachOverrides = pickSellerOutreachOverrides(req.body);
  const templateId = req.body.template_id || req.body.templateId || null;
  const brevoTemplate = templateId ? getBrevoTemplateById(templateId) : null;

  if (templateId && !brevoTemplate) {
    throw new ServerError('Unsupported Brevo template selected', 400, ErrorCode.BAD_REQUEST);
  }

  const matched = await loadSellerForBrevo(db, { sellerId: sellerIdInput, email: to });

  const companyName =
    outreachOverrides.company_name ||
    companyInput ||
    String(matched?.company_name || '').trim() ||
    to.split('@')[0] ||
    'your company';

  if (brevoTemplate?.key === 'seller_outreach') {
    const hasManualParams = hasCompleteSellerOutreachOverrides(outreachOverrides);

    if (!hasManualParams) {
      assertSellerOutreachRequirements({ sender, companyInput: companyName, matched });

      if (!matched) {
        throw new ServerError(
          'Seller Outreach template (#4) requires seller data or all template parameters filled manually.',
          400,
          ErrorCode.BAD_REQUEST
        );
      }
    }
  }

  const categories =
    brevoTemplate?.key === 'seller_outreach' && matched
      ? await fetchSellerCategories(db, {
          sellerUuid: matched.seller_uuid,
          gemSellerId: matched.gem_seller_id,
        })
      : [];

  const defaultTemplate = Mail.DEFAULT_TEMPLATE;
  const brandMail = Mail.buildBrandOutreachMail({
    brandLabel: companyName,
    companyName,
    template: defaultTemplate,
  });

  const finalSubject =
    subjectInput ||
    getDefaultSubjectForTemplate(brevoTemplate?.key, companyName) ||
    brandMail.subject;

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

  const templateParams = buildBrevoTemplateParams({
    templateKey: brevoTemplate?.key,
    companyName,
    to,
    finalSubject,
    seller: matched,
    sender,
    categories,
  });

  if (brevoTemplate?.key === 'seller_outreach' && Object.keys(outreachOverrides).length > 0) {
    Object.assign(templateParams, outreachOverrides);
  }

  if (brevoTemplate?.key === 'seller_outreach' && !hasCompleteSellerOutreachOverrides(templateParams)) {
    throw new ServerError(
      'Seller Outreach template requires company_name, total_contract_value, categories, person_name, and person_phone.',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const sendResult = await sendTransactionalEmail({
    to,
    subject: finalSubject,
    htmlContent: brevoTemplate ? undefined : finalHtmlContent,
    templateId: Number(templateId),
    templateParams,
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
          message: brevoTemplate ? null : finalHtmlContent,
          provider: 'brevo',
          transport: sendResult.transport || null,
          template_id: templateId || null,
          template_key: brevoTemplate?.key || null,
          template_params: templateParams,
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
    template_key: brevoTemplate?.key || null,
    template_params: templateParams,
    seller_id: matched?.seller_uuid || null,
    messageId: messageId || null,
    transport: sendResult.transport || null,
    from_email: sender.email,
    from_name: sender.name,
  });
};
