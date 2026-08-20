const nodemailer = require('nodemailer');
const env = require('@/config/env');

let cachedTransporter = null;

function getConfig() {
  return {
    host: String(env.SMTP_HOST || '').trim(),
    port: Number(env.SMTP_PORT || 587),
    user: String(env.SMTP_USER || '').trim(),
    pass: String(env.SMTP_PASS || '').trim(),
    from: String(env.SMTP_FROM || env.SMTP_USER || '').trim(),
    secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
  };
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const cfg = getConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
  return cachedTransporter;
}

async function send({ to, subject, html, text }) {
  if (!to) return { success: false, reason: 'missing_recipient' };
  if (!subject) return { success: false, reason: 'missing_subject' };
  if (!html && !text) return { success: false, reason: 'missing_body' };

  const cfg = getConfig();
  const transporter = getTransporter();
  if (!cfg.from || !transporter) {
    return { success: false, reason: 'config' };
  }

  try {
    const result = await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      html,
      text,
    });
    return {
      success: true,
      messageId: result?.messageId || null,
      accepted: result?.accepted || [],
      rejected: result?.rejected || [],
    };
  } catch (error) {
    return {
      success: false,
      reason: 'transport',
      message: error?.message || 'Failed to send email',
    };
  }
}

module.exports = {
  getConfig,
  send,
};
