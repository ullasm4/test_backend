const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Schema = require('@/config/validationSchema');
const { getBrevoTemplateById } = require('@/config/brevoTemplates');
const { loadBrevoMailSender } = require('@/lib/userMailSender');
const { loadSellerForBrevo } = require('@/lib/brevoSellerLookup');
const { assertSellerAssignedToUser } = require('@/lib/sellerAssignment');
const { assertSellerMailSendAllowed } = require('@/service/mail/mailSendLimits');
const { sendBrevoEmailToSeller } = require('@/lib/brevoEmailSend');

function assertSellerOutreachRequirements({ sender, companyInput, matched }) {
  if (!String(sender.personName || '').trim()) {
    throw new ServerError(
      'Your profile name is required to send Seller Outreach template (person_name)',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  if (!String(sender.personPhone || '').trim()) {
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

  const sender = await loadBrevoMailSender(db, req.user.id);

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

  if (sellerIdInput) {
    await assertSellerAssignedToUser(db, sellerIdInput, req.user.id);
  } else if (matched?.seller_uuid) {
    await assertSellerAssignedToUser(db, matched.seller_uuid, req.user.id);
  }

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

  if (matched?.seller_uuid) {
    await assertSellerMailSendAllowed(db, {
      sellerId: matched.seller_uuid,
      email: to,
    });
  } else {
    await assertSellerMailSendAllowed(db, { email: to });
  }

  const seller = matched || {
    seller_uuid: null,
    gem_seller_id: null,
    company_name: companyName,
    total_value: 0,
    email: to,
  };

  const result = await sendBrevoEmailToSeller(db, {
    seller,
    sender,
    brevoTemplate,
    templateId,
    subjectInput,
    htmlInput,
    outreachOverrides,
    sentByUserId: req.user.id,
    enforceCooldown: false,
  });

  return res.status(200).json({
    success: true,
    message: 'Email sent successfully via Brevo',
    ...result,
  });
};
