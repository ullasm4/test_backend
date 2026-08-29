const axios = require('axios');
const nodemailer = require('nodemailer');
const env = require('@/config/env');

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
        messageId: response.data?.messageId || 'brevo-api-sent',
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
    });
    return {
      success: true,
      messageId: info.messageId || 'brevo-smtp-sent',
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

module.exports = {
  sendTransactionalEmail,
};
