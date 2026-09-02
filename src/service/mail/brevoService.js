const axios = require('axios');
const nodemailer = require('nodemailer');
const env = require('@/config/env');
const { normalizeMessageId } = require('@/lib/messageId');

function getBrevoRestApiKey() {
  for (const value of [env.BREVO_API_KEY, env.BREVO_SMTP_PASS]) {
    const key = String(value || '').trim();
    if (key.startsWith('xkeysib-')) return key;
  }
  return null;
}

function getBrevoSmtpPassword() {
  for (const value of [env.BREVO_SMTP_PASS, env.BREVO_API_KEY]) {
    const key = String(value || '').trim();
    if (key.startsWith('xsmtpsib-')) return key;
  }
  return '';
}

function buildSibApiHeader({ templateId, templateParams, subject, senderEmail, senderName, replyTo }) {
  const payload = {
    templateId: Number(templateId),
    sender: {
      name: senderName,
      email: senderEmail,
    },
  };

  if (templateParams && typeof templateParams === 'object' && Object.keys(templateParams).length > 0) {
    payload.params = templateParams;
  }

  if (subject) {
    payload.subject = subject;
  }

  if (replyTo) {
    payload.replyTo = { email: replyTo };
  }

  return JSON.stringify(payload);
}

async function getSmtpTemplate(templateId) {
  const apiKey = getBrevoRestApiKey();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY (xkeysib-...) is required to load transactional templates.');
  }

  try {
    const response = await axios.get(`https://api.brevo.com/v3/smtp/templates/${Number(templateId)}`, {
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
      },
    });

    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    const errMsg = error.response?.data?.message || error.message;
    throw new Error(`Brevo Get Template API Error: ${errMsg}`);
  }
}

async function assertTransactionalTemplateAvailable(templateId) {
  const template = await getSmtpTemplate(templateId);
  if (!template) {
    throw new Error(
      `Brevo transactional template #${templateId} was not found. Templates under Marketing > Templates are not usable here. Create or copy the design under Transactional > Email templates in Brevo, then use that template ID.`
    );
  }

  if (template.isActive === false) {
    throw new Error(`Brevo transactional template #${templateId} exists but is inactive. Activate it in Brevo before sending.`);
  }

  return template;
}

async function sendViaBrevoApi({
  apiKey,
  to,
  subject,
  htmlContent,
  templateId,
  templateParams,
  senderEmail,
  senderName,
  replyTo,
}) {
  const apiPayload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
  };

  if (replyTo) {
    apiPayload.replyTo = { email: replyTo };
  }

  if (templateId) {
    apiPayload.templateId = Number(templateId);
    if (templateParams && typeof templateParams === 'object') {
      apiPayload.params = templateParams;
    }
    if (subject) {
      apiPayload.subject = subject;
    }
  } else {
    if (!subject) {
      throw new Error('Email subject is required when templateId is not provided.');
    }
    apiPayload.subject = subject;
    apiPayload.htmlContent = htmlContent || '<p></p>';
  }

  try {
    const response = await axios.post('https://api.brevo.com/v3/smtp/email', apiPayload, {
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
    });

    return {
      success: true,
      messageId: normalizeMessageId(response.data?.messageId) || 'brevo-api-sent',
      transport: 'brevo-api',
      data: response.data,
    };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    throw new Error(`Brevo API Error: ${errMsg}`);
  }
}

async function sendViaBrevoSmtp({
  smtpPassword,
  to,
  subject,
  htmlContent,
  templateId,
  templateParams,
  senderEmail,
  senderName,
  replyTo,
}) {
  const smtpHost = env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const smtpPort = Number(env.BREVO_SMTP_PORT) || 587;
  const smtpUser = env.BREVO_SMTP_USER || env.SENDER_EMAIL;

  if (!templateId && !subject) {
    throw new Error('Email subject is required for SMTP transport.');
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser ? smtpUser.trim() : senderEmail.trim(),
      pass: smtpPassword,
    },
  });

  const mailOptions = {
    from: `"${senderName}" <${senderEmail}>`,
    to,
    replyTo: replyTo || undefined,
  };

  if (templateId) {
    mailOptions.headers = {
      'X-SIB-API': buildSibApiHeader({
        templateId,
        templateParams,
        subject,
        senderEmail,
        senderName,
        replyTo,
      }),
    };
    if (subject) {
      mailOptions.subject = subject;
    }
  } else {
    mailOptions.subject = subject;
    mailOptions.html = htmlContent || '<p></p>';
  }

  try {
    const info = await transporter.sendMail(mailOptions);

    return {
      success: true,
      messageId: normalizeMessageId(info.messageId) || 'brevo-smtp-sent',
      transport: 'brevo-smtp',
      data: info,
    };
  } catch (error) {
    const msg = error.message || '';
    if (msg.includes('535') || msg.includes('Authentication failed')) {
      throw new Error(
        `Brevo SMTP Auth Failed (535): Brevo rejected login for '${smtpUser}'. Please verify your SMTP credentials or API key starting with xkeysib-.`
      );
    }
    throw new Error(`Brevo SMTP Error: ${msg}`);
  }
}

/**
 * Sends a transactional email using Brevo.
 * Registered Brevo templates use REST API when xkeysib-* key is set,
 * otherwise SMTP relay with X-SIB-API header (xsmtpsib-* key).
 *
 * @param {Object} params
 * @param {string} params.to - Recipient email address
 * @param {string} [params.subject] - Email subject
 * @param {string} [params.htmlContent] - Email HTML or text body
 * @param {number|string} [params.templateId] - Brevo registered Template ID (optional)
 * @param {Object} [params.templateParams] - Dynamic parameters for registered template
 * @param {string} [params.senderEmail] - Optional override sender email
 * @param {string} [params.senderName] - Optional override sender name
 * @param {string} [params.replyTo] - Optional reply-to email address
 * @returns {Promise<{ success: boolean, messageId: string, data?: any }>}
 */
async function sendTransactionalEmail({
  to,
  subject,
  htmlContent,
  templateId,
  templateParams,
  senderEmail: customSenderEmail,
  senderName: customSenderName,
  replyTo,
}) {
  const restApiKey = getBrevoRestApiKey();
  const smtpPassword = getBrevoSmtpPassword();

  const senderEmail = customSenderEmail || env.SENDER_EMAIL || env.EMAIL_USER || 'info@pem.co.in';
  const senderName = customSenderName || env.SENDER_NAME || 'PEM';

  if (!restApiKey && !smtpPassword) {
    throw new Error('Brevo credentials (BREVO_API_KEY or BREVO_SMTP_PASS) are missing in environment configuration.');
  }

  const cleanTo = String(to || '').trim();
  const cleanSubject = String(subject || '').trim();
  const cleanHtml = String(htmlContent || '').trim();
  const cleanReplyTo = replyTo ? String(replyTo).trim().toLowerCase() : null;
  const templateIdNum = templateId ? Number(templateId) : null;

  if (!cleanTo) {
    throw new Error('Recipient email address is required.');
  }

  if (templateIdNum) {
    if (restApiKey) {
      await assertTransactionalTemplateAvailable(templateIdNum);

      return sendViaBrevoApi({
        apiKey: restApiKey,
        to: cleanTo,
        subject: cleanSubject,
        templateId: templateIdNum,
        templateParams,
        senderEmail,
        senderName,
        replyTo: cleanReplyTo,
      });
    }

    if (smtpPassword) {
      return sendViaBrevoSmtp({
        smtpPassword,
        to: cleanTo,
        subject: cleanSubject,
        templateId: templateIdNum,
        templateParams,
        senderEmail,
        senderName,
        replyTo: cleanReplyTo,
      });
    }

    throw new Error(
      'Brevo credentials are missing. Set BREVO_SMTP_PASS (xsmtpsib-...) or BREVO_API_KEY (xkeysib-...).'
    );
  }

  if (restApiKey) {
    return sendViaBrevoApi({
      apiKey: restApiKey,
      to: cleanTo,
      subject: cleanSubject,
      htmlContent: cleanHtml,
      senderEmail,
      senderName,
      replyTo: cleanReplyTo,
    });
  }

  return sendViaBrevoSmtp({
    smtpPassword,
    to: cleanTo,
    subject: cleanSubject,
    htmlContent: cleanHtml,
    senderEmail,
    senderName,
    replyTo: cleanReplyTo,
  });
}

/**
 * Creates a new webhook in Brevo via API v3 POST /webhooks
 * Reference: https://developers.brevo.com/reference/create-webhook
 *
 * @param {Object} params
 * @param {string} params.url - Absolute URL of the webhook
 * @param {string[]} [params.events] - Array of events to track
 * @param {string} [params.type] - Webhook type ('transactional' | 'marketing')
 * @param {string} [params.description] - Description for the webhook
 * @param {Array<{key: string, value: string}>} [params.headers] - Custom headers
 * @returns {Promise<{ success: boolean, id: number, data: any }>}
 */
const DEFAULT_TRANSACTIONAL_WEBHOOK_EVENTS = [
  'sent',
  'delivered',
  'opened',
  'uniqueOpened',
  'click',
  'softBounce',
  'hardBounce',
  'invalid',
  'deferred',
  'blocked',
  'spam',
  'unsubscribed',
];

async function createWebhook({
  url,
  events = DEFAULT_TRANSACTIONAL_WEBHOOK_EVENTS,
  type = 'transactional',
  description = 'Transactional email webhook handler',
  headers,
}) {
  const apiKey = getBrevoRestApiKey();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY (xkeysib-...) is required to create a webhook via Brevo API.');
  }

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error('Valid absolute webhook URL (starting with http:// or https://) is required.');
  }

  const payload = {
    url,
    events,
    type,
    description,
  };

  if (Array.isArray(headers) && headers.length > 0) {
    payload.headers = headers;
  }

  try {
    const response = await axios.post('https://api.brevo.com/v3/webhooks', payload, {
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
    });

    return {
      success: true,
      id: response.data?.id,
      data: response.data,
    };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    throw new Error(`Brevo Create Webhook API Error: ${errMsg}`);
  }
}

/**
 * Fetches all webhooks configured in Brevo via API v3 GET /webhooks
 *
 * @param {string} [type='transactional'] - Webhook type ('transactional' | 'marketing')
 * @returns {Promise<{ success: boolean, webhooks: any[] }>}
 */
async function getWebhooks(type = 'transactional') {
  const apiKey = getBrevoRestApiKey();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY (xkeysib-...) is required to list webhooks.');
  }

  try {
    const response = await axios.get('https://api.brevo.com/v3/webhooks', {
      params: { type },
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
      },
    });

    return {
      success: true,
      webhooks: response.data?.webhooks || [],
    };
  } catch (error) {
    const errMsg = error.response?.data?.message || error.message;
    throw new Error(`Brevo Get Webhooks API Error: ${errMsg}`);
  }
}

module.exports = {
  sendTransactionalEmail,
  getBrevoRestApiKey,
  getBrevoSmtpPassword,
  getSmtpTemplate,
  assertTransactionalTemplateAvailable,
  createWebhook,
  getWebhooks,
  DEFAULT_TRANSACTIONAL_WEBHOOK_EVENTS,
};

