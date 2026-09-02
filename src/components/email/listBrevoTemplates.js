const { BREVO_TEMPLATES } = require('@/config/brevoTemplates');
const { getDefaultMailSender } = require('@/lib/userMailSender');
const { getBrevoRestApiKey, getBrevoSmtpPassword, getSmtpTemplate } = require('@/service/mail/brevoService');

async function loadTransactionalTemplateStatus(templateId) {
  const restApiKey = getBrevoRestApiKey();
  const smtpPassword = getBrevoSmtpPassword();

  if (!restApiKey) {
    if (smtpPassword) {
      return {
        transactional_available: null,
        transactional_active: null,
        transactional_name: null,
        setup_hint: null,
        transport: 'brevo-smtp',
      };
    }

    return {
      transactional_available: false,
      transactional_active: false,
      transactional_name: null,
      setup_hint:
        'Configure BREVO_SMTP_PASS (xsmtpsib-...) or BREVO_API_KEY (xkeysib-...) in backend/.env.',
      transport: null,
    };
  }

  try {
    const template = await getSmtpTemplate(templateId);
    if (!template) {
      return {
        transactional_available: false,
        transactional_active: false,
        transactional_name: null,
        setup_hint:
          'Not found in Transactional templates. Copy this design to Transactional > Email templates in Brevo (Marketing templates cannot be sent via API).',
        transport: 'brevo-api',
      };
    }

    return {
      transactional_available: true,
      transactional_active: Boolean(template.isActive),
      transactional_name: template.name || null,
      setup_hint: template.isActive
        ? null
        : 'Template exists in Transactional but is inactive. Activate it in Brevo before sending.',
      transport: 'brevo-api',
    };
  } catch (error) {
    return {
      transactional_available: null,
      transactional_active: null,
      transactional_name: null,
      setup_hint: error.message,
    };
  }
}

exports.validationSchema = {};

exports.controller = async (_req, res) => {
  const templates = await Promise.all(
    BREVO_TEMPLATES.map(async (template) => {
      const status = await loadTransactionalTemplateStatus(template.id);
      return {
        id: template.id,
        key: template.key,
        name: template.name,
        description: template.description,
        param_keys: template.param_keys,
        ...status,
      };
    })
  );

  return res.status(200).json({
    data: templates,
    sender: getDefaultMailSender(),
  });
};
