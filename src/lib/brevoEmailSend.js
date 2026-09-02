const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Mail = require('@/service/mail');
const { sendTransactionalEmail } = require('@/service/mail/brevoService');
const { normalizeMessageId } = require('@/lib/messageId');
const { fetchSellerCategories } = require('@/lib/sellerCategories');
const { buildBrevoTemplateParams, getDefaultSubjectForTemplate } = require('@/lib/brevoTemplateParams');
const { createEmailSentNotification } = require('@/lib/brevoNotificationSync');
const { assertSellerMailSendAllowed } = require('@/service/mail/mailSendLimits');

async function sendBrevoEmailToSeller(
  db,
  {
    seller,
    sender,
    brevoTemplate,
    templateId,
    subjectInput = '',
    htmlInput = '',
    outreachOverrides = {},
    sentByUserId,
    enforceCooldown = true,
    bulkSend = false,
  }
) {
  const to = String(seller?.email || '').trim().toLowerCase();
  if (!to) {
    throw new ServerError('Seller email is required', 400, ErrorCode.BAD_REQUEST);
  }

  if (enforceCooldown) {
    await assertSellerMailSendAllowed(db, {
      sellerId: seller.seller_uuid,
      email: to,
    });
  }

  const companyName =
    outreachOverrides.company_name ||
    String(seller?.company_name || '').trim() ||
    to.split('@')[0] ||
    'your company';

  const categories =
    brevoTemplate?.key === 'seller_outreach'
      ? await fetchSellerCategories(db, {
          sellerUuid: seller.seller_uuid,
          gemSellerId: seller.gem_seller_id,
        })
      : [];

  const defaultTemplate = Mail.DEFAULT_TEMPLATE;
  const brandMail = Mail.buildBrandOutreachMail({
    brandLabel: companyName,
    companyName,
    template: defaultTemplate,
  });

  const finalSubject =
    String(subjectInput || '').trim() ||
    getDefaultSubjectForTemplate(brevoTemplate?.key) ||
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
    seller,
    sender,
    categories,
  });

  if (brevoTemplate?.key === 'seller_outreach' && Object.keys(outreachOverrides).length > 0) {
    Object.assign(templateParams, outreachOverrides);
  }

  if (brevoTemplate?.key === 'seller_outreach') {
    const required = ['company_name', 'total_contract_value', 'categories', 'person_name', 'person_phone'];
    const missing = required.filter((key) => !String(templateParams[key] || '').trim());
    if (missing.length) {
      throw new ServerError(
        'Seller Outreach template requires company_name, total_contract_value, categories, person_name, and person_phone.',
        400,
        ErrorCode.BAD_REQUEST
      );
    }
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
      seller.seller_uuid || null,
      seller.gem_seller_id || null,
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
        bulk_send: bulkSend,
      }),
      sentByUserId,
    ]
  );

  await createEmailSentNotification(db, {
    userId: sentByUserId,
    sellerId: seller.seller_uuid || null,
    email: to,
    companyName,
    messageId,
  }).catch((error) => {
    console.error('[notifications] failed to create sent notification:', error?.message || error);
  });

  if (seller.seller_uuid) {
    await db.query(
      `
      UPDATE new_seller_details
      SET
        email_sent = TRUE,
        email_sent_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [seller.seller_uuid]
    );
  }

  return {
    success: true,
    to,
    company_name: companyName,
    subject: finalSubject,
    template_id: templateId,
    template_key: brevoTemplate?.key || null,
    template_params: templateParams,
    seller_id: seller.seller_uuid || null,
    messageId: messageId || null,
    transport: sendResult.transport || null,
    from_email: sender.email,
    from_name: sender.name,
  };
}

module.exports = {
  sendBrevoEmailToSeller,
};
