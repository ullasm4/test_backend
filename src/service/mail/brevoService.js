const axios = require('axios');
const nodemailer = require('nodemailer');
const env = require('@/config/env');
const { normalizeMessageId } = require('@/lib/messageId');

/**
 * Sends a transactional email using Brevo.
 * Supports both REST API v3 (for xkeysib-* keys & registered Brevo Template IDs)
 * and Nodemailer SMTP (for xsmtpsib-* keys / SMTP credentials).
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
  const smtpHost = env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const smtpPort = Number(env.BREVO_SMTP_PORT) || 587;
  const smtpUser = env.BREVO_SMTP_USER || env.SENDER_EMAIL;
  const passKey = env.BREVO_SMTP_PASS || env.BREVO_API_KEY;

  const senderEmail = customSenderEmail || env.SENDER_EMAIL || env.EMAIL_USER || 'info@pem.co.in';
  const senderName = customSenderName || env.SENDER_NAME || 'PEM';

  if (!passKey) {
    throw new Error('Brevo credentials (BREVO_SMTP_PASS or BREVO_API_KEY) are missing in environment configuration.');
  }

  const cleanPassKey = passKey.trim();
  const cleanTo = String(to || '').trim();
  const cleanSubject = String(subject || '').trim();
  const cleanHtml = String(htmlContent || '').trim();
  const cleanReplyTo = replyTo ? String(replyTo).trim().toLowerCase() : null;

  if (!cleanTo) {
    throw new Error('Recipient email address is required.');
  }

  // If key starts with xkeysib-, use Brevo REST API v3
  if (cleanPassKey.startsWith('xkeysib-')) {
    try {
      const apiPayload = {
        sender: { name: senderName, email: senderEmail },
        to: [{ email: cleanTo }],
      };

      if (cleanReplyTo) {
        apiPayload.replyTo = { email: cleanReplyTo };
      }

      if (templateId) {
        apiPayload.templateId = Number(templateId);
        if (templateParams && typeof templateParams === 'object') {
          apiPayload.params = templateParams;
        }
        if (cleanSubject) {
          apiPayload.subject = cleanSubject;
        }
      } else {
        if (!cleanSubject) {
          throw new Error('Email subject is required when templateId is not provided.');
        }
        apiPayload.subject = cleanSubject;
        apiPayload.htmlContent = cleanHtml || '<p></p>';
      }

      const response = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        apiPayload,
        {
          headers: {
            accept: 'application/json',
            'api-key': cleanPassKey,
            'content-type': 'application/json',
          },
        }
      );
      return {
        success: true,
        messageId: normalizeMessageId(response.data?.messageId) || 'brevo-api-sent',
        data: response.data,
      };
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message;
      throw new Error(`Brevo API Error: ${errMsg}`);
    }
  }

  // Otherwise, use Nodemailer SMTP transport
  if (!cleanSubject) {
    throw new Error('Email subject is required for SMTP transport.');
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser ? smtpUser.trim() : senderEmail.trim(),
      pass: cleanPassKey,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: cleanTo,
      subject: cleanSubject,
      html: cleanHtml || '<p></p>',
      replyTo: cleanReplyTo || undefined,
    });
    return {
      success: true,
      messageId: normalizeMessageId(info.messageId) || 'brevo-smtp-sent',
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
  const apiKey = (env.BREVO_API_KEY || env.BREVO_SMTP_PASS || '').trim();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is required to create a webhook via Brevo API.');
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
  const apiKey = (env.BREVO_API_KEY || env.BREVO_SMTP_PASS || '').trim();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is required to list webhooks.');
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
  createWebhook,
  getWebhooks,
  DEFAULT_TRANSACTIONAL_WEBHOOK_EVENTS,
};

