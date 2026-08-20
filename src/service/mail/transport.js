const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const env = require('@/config/env');

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

const senderEmail = String(env.EMAIL_USER || env.GMAIL_SENDER_EMAIL || '').trim();
const keyFileConfig = String(env.GMAIL_SERVICE_ACCOUNT_KEY || './service_account.json').trim();

const BACKEND_ROOT = path.join(__dirname, '../../..');

function resolveKeyFilePath(keyPath) {
  if (!keyPath) return '';
  if (path.isAbsolute(keyPath)) return keyPath;
  return path.resolve(BACKEND_ROOT, keyPath);
}

/**
 * Load + validate Google service account JSON.
 * Rejects OAuth "web"/"installed" client secrets (those have no private_key).
 */
function loadServiceAccountCredentials(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing_file', message: `Key file not found: ${filePath || '(empty path)'}` };
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'invalid_json', message: `Key file is not valid JSON: ${error.message}` };
  }

  if (raw?.web || raw?.installed) {
    return {
      ok: false,
      reason: 'oauth_client',
      message:
        'service_account.json is an OAuth client secret (web/installed), not a service account key. '
        + 'In Google Cloud Console → IAM → Service Accounts → Keys → Add key → Create new key → JSON, '
        + 'download that file and replace backend/service_account.json',
    };
  }

  if (raw?.type && raw.type !== 'service_account') {
    return {
      ok: false,
      reason: 'wrong_type',
      message: `Expected type "service_account", got "${raw.type}"`,
    };
  }

  if (!raw?.client_email || !raw?.private_key) {
    return {
      ok: false,
      reason: 'missing_fields',
      message:
        'service_account.json must include client_email and private_key '
        + '(download the Service Account JSON key, not OAuth Client ID credentials)',
    };
  }

  return { ok: true, credentials: raw };
}

const keyFilePath = resolveKeyFilePath(keyFileConfig);
const keyLoad = loadServiceAccountCredentials(keyFilePath);
const isConfigured = Boolean(senderEmail && keyLoad.ok);

if (!senderEmail) {
  console.warn('Gmail API: EMAIL_USER / GMAIL_SENDER_EMAIL is not set');
} else if (!keyLoad.ok) {
  console.warn(`Gmail API transport not initialized — ${keyLoad.message}`);
}

/**
 * Encode Subject for UTF-8 (RFC 2047) when non-ASCII characters are present.
 */
function encodeSubject(subject) {
  const value = String(subject || '');
  if (!/[^\x00-\x7F]/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((item) => {
      if (!item) return null;
      const filePath = item.path ? String(item.path) : '';
      if (!filePath || !fs.existsSync(filePath)) return null;
      return {
        filename: item.filename || path.basename(filePath),
        contentType: item.contentType || 'application/octet-stream',
        cid: item.cid ? String(item.cid) : null,
        content: fs.readFileSync(filePath),
      };
    })
    .filter(Boolean);
}

/**
 * Encodes the email message into base64url format required by Gmail API.
 */
function createRawEmail({ from, to, subject, html, attachments = [] }) {
  const inlineAttachments = normalizeAttachments(attachments);
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
  ];

  let body;
  if (!inlineAttachments.length) {
    headers.push('Content-Type: text/html; charset=utf-8');
    body = String(html || '');
  } else {
    const boundary = `pem_mail_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    headers.push(`Content-Type: multipart/related; boundary="${boundary}"`);

    const parts = [
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      String(html || ''),
    ];

    for (const attachment of inlineAttachments) {
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${attachment.contentType}; name="${attachment.filename}"`);
      parts.push('Content-Transfer-Encoding: base64');
      if (attachment.cid) {
        parts.push(`Content-ID: <${attachment.cid}>`);
        parts.push('Content-Disposition: inline');
      } else {
        parts.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      }
      parts.push('');
      parts.push(attachment.content.toString('base64').replace(/(.{76})/g, '$1\r\n'));
    }

    parts.push(`--${boundary}--`);
    body = parts.join('\r\n');
  }

  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send via Gmail API using a service account with domain-wide delegation.
 */
async function sendMail({ from, to, subject, html, attachments }) {
  if (!isConfigured) {
    throw new Error(keyLoad.message || 'Gmail API transport is not configured');
  }

  const sender = from || senderEmail;

  const auth = new google.auth.JWT({
    email: keyLoad.credentials.client_email,
    key: keyLoad.credentials.private_key,
    scopes: SCOPES,
    subject: sender,
  });

  const gmail = google.gmail({ version: 'v1', auth });
  const raw = createRawEmail({
    from: sender,
    to,
    subject,
    html,
    attachments,
  });

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return {
    messageId: response?.data?.id || null,
    response,
  };
}

module.exports = isConfigured ? { sendMail } : null;
