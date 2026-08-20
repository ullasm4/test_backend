const Transport = require('./transport');
const env = require('@/config/env');
const {
  DEFAULT_MAIL_TYPE,
  DEFAULT_TEMPLATE,
  buildBrandOutreachMail,
  replacePlaceholders,
  templateBodyToHtml,
  buildBrandOutreachHtml,
  withBrandOutreachLogo,
} = require('./brandOutreachTemplate');
const { extractEmailsFromBrandEmail } = require('./extractEmails');

let dailyLimitReached = false;

function isDailySendLimitError(error) {
  const message = String(
    error?.message || error?.response?.data?.error?.message || error?.response || '',
  );
  const responseCode = error?.responseCode || error?.code || error?.status;
  return (
    responseCode === 550
    || responseCode === 429
    || /daily user sending limit exceeded/i.test(message)
    || /daily sending quota exceeded/i.test(message)
    || /user-rate limit exceeded/i.test(message)
    || /quota exceeded/i.test(message)
    || /550-5\.4\.5/i.test(message)
  );
}

function getConfig() {
  return {
    from: String(env.EMAIL_USER || env.GMAIL_SENDER_EMAIL || '').trim(),
    serviceAccountKey: String(env.GMAIL_SERVICE_ACCOUNT_KEY || './service_account.json').trim(),
    configured: Boolean(Transport?.sendMail),
  };
}

/**
 * Send email via Gmail API. Never throws — failures are returned as { success: false }.
 * Accepts either positional (to, subject, html, options) or object ({ to, subject, html, text, attachments }).
 */
async function send(toOrOptions, subjectArg, htmlArg, optionsArg = {}) {
  const isObjectForm = toOrOptions && typeof toOrOptions === 'object' && !Array.isArray(toOrOptions);
  const to = isObjectForm ? toOrOptions.to : toOrOptions;
  const subject = isObjectForm ? toOrOptions.subject : subjectArg;
  const html = isObjectForm ? (toOrOptions.html || toOrOptions.text) : htmlArg;
  const options = isObjectForm
    ? { attachments: toOrOptions.attachments || [] }
    : optionsArg;

  if (dailyLimitReached) {
    console.warn('Email skipped: Gmail daily sending limit already exceeded', { to, subject });
    return { success: false, skipped: true, reason: 'daily_limit' };
  }

  if (!to) {
    console.warn('Email skipped: missing recipient', { subject });
    return { success: false, skipped: true, reason: 'missing_recipient' };
  }

  if (!subject) {
    console.warn('Email skipped: missing subject', { to });
    return { success: false, skipped: true, reason: 'missing_subject' };
  }

  if (!html) {
    console.warn('Email skipped: missing body', { to, subject });
    return { success: false, skipped: true, reason: 'missing_body' };
  }

  const from = getConfig().from;
  if (!from) {
    console.warn('Email skipped: sender not configured', { to, subject });
    return { success: false, skipped: true, reason: 'config' };
  }

  if (!Transport?.sendMail) {
    console.error('Email skipped: mail transport not initialized', { to, subject });
    return { success: false, skipped: true, reason: 'transport' };
  }

  try {
    const result = await Transport.sendMail({
      from,
      to,
      subject,
      html,
      attachments: options.attachments || [],
    });
    console.log(`Mail sent to ${to} | messageId=${result?.messageId || 'n/a'}`);
    return { success: true, messageId: result?.messageId || null };
  } catch (error) {
    if (isDailySendLimitError(error)) {
      dailyLimitReached = true;
      console.warn(
        'Email send failed: Gmail daily sending limit exceeded. Further emails skipped until process restart.',
        { to, subject },
      );
      return { success: false, reason: 'daily_limit', message: error.message };
    }

    console.error('Email send failed', {
      to,
      subject,
      message: error?.message,
      code: error?.code,
      responseCode: error?.responseCode,
    });
    return { success: false, reason: 'transport', message: error?.message };
  }
}

function resetDailyLimitFlag() {
  dailyLimitReached = false;
}

module.exports = {
  getConfig,
  send,
  resetDailyLimitFlag,
  DEFAULT_MAIL_TYPE,
  DEFAULT_TEMPLATE,
  buildBrandOutreachMail,
  replacePlaceholders,
  templateBodyToHtml,
  buildBrandOutreachHtml,
  withBrandOutreachLogo,
  extractEmailsFromBrandEmail,
};
