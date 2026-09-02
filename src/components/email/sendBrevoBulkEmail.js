const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Schema = require('@/config/validationSchema');
const { getBrevoTemplateById } = require('@/config/brevoTemplates');
const { loadBrevoMailSender } = require('@/lib/userMailSender');
const {
  MAX_BULK_LIMIT,
  SELLER_MAIL_COOLDOWN_DAYS,
  listEligibleBulkSellers,
} = require('@/lib/brevoBulkSellers');
const { sendBrevoEmailToSeller } = require('@/lib/brevoEmailSend');

const BULK_SEND_CONCURRENCY = 5;

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

exports.validationSchema = {
  body: Joi.object({
    limit: Joi.number().integer().min(1).max(MAX_BULK_LIMIT).required(),
    template_id: Joi.number().integer().positive().required(),
    templateId: Joi.number().integer().positive().optional(),
    subject: Joi.string().trim().min(1).max(255).optional().allow(''),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const isAdmin = req.user.role === 'admin';
  const limit = Math.min(Math.max(Number(req.body.limit) || 0, 1), MAX_BULK_LIMIT);
  const templateId = req.body.template_id || req.body.templateId || null;
  const subjectInput = String(req.body.subject || '').trim();
  const brevoTemplate = templateId ? getBrevoTemplateById(templateId) : null;

  if (!brevoTemplate) {
    throw new ServerError('Unsupported Brevo template selected', 400, ErrorCode.BAD_REQUEST);
  }

  if (brevoTemplate.key !== 'pem_invitation') {
    throw new ServerError(
      'Bulk send only supports the PEM invitation template',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const sender = await loadBrevoMailSender(db, req.user.id);

  const sellers = await listEligibleBulkSellers(db, {
    userId: req.user.id,
    isAdmin,
    limit,
  });

  if (!sellers.length) {
    return res.status(200).json({
      success: true,
      message: 'No eligible sellers found for bulk send',
      requested: limit,
      eligible_total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      cooldown_days: SELLER_MAIL_COOLDOWN_DAYS,
      failures: [],
    });
  }

  const outcomes = await mapWithConcurrency(sellers, BULK_SEND_CONCURRENCY, async (seller) => {
    try {
      const result = await sendBrevoEmailToSeller(db, {
        seller,
        sender,
        brevoTemplate,
        templateId,
        subjectInput,
        sentByUserId: req.user.id,
        enforceCooldown: true,
        bulkSend: true,
      });

      return {
        status: 'sent',
        seller_id: seller.seller_uuid,
        company_name: seller.company_name,
        email: seller.email,
        messageId: result.messageId,
      };
    } catch (error) {
      return {
        status: 'failed',
        seller_id: seller.seller_uuid,
        company_name: seller.company_name,
        email: seller.email,
        error: error?.message || 'Failed to send email',
      };
    }
  });

  const sent = outcomes.filter((item) => item.status === 'sent').length;
  const failed = outcomes.filter((item) => item.status === 'failed').length;
  const failures = outcomes
    .filter((item) => item.status === 'failed')
    .slice(0, 25)
    .map((item) => ({
      seller_id: item.seller_id,
      company_name: item.company_name,
      email: item.email,
      error: item.error,
    }));

  return res.status(200).json({
    success: failed === 0,
    message:
      failed === 0
        ? `Bulk send completed. ${sent} email(s) sent via Brevo.`
        : `Bulk send finished with ${failed} failure(s). ${sent} email(s) sent.`,
    requested: limit,
    processed: sellers.length,
    sent,
    failed,
    skipped: Math.max(limit - sellers.length, 0),
    cooldown_days: SELLER_MAIL_COOLDOWN_DAYS,
    template_id: templateId,
    template_key: brevoTemplate.key,
    failures,
  });
};
