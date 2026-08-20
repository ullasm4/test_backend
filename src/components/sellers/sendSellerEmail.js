const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Mail = require('@/service/mail');
const { PRIMARY_SELLER_CONTACT } = require('@/lib/newTableSql');
const Schema = require('@/config/validationSchema');

exports.validationSchema = {
  params: Joi.object({
    id: Schema.uuid().required(),
  }),
  body: Joi.object({
    subject: Joi.string().trim().min(1).max(255).optional(),
    message: Joi.string().trim().min(1).max(10000).required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const sellerId = req.params.id;
  const subject = String(req.body.subject || '').trim() || 'Inquiry from contract desk';
  const message = String(req.body.message || '').trim();

  const [sellerRes] = await Promise.all([
    db.query(
      `
      SELECT
        sd.id AS seller_uuid,
        sd.seller_id AS gem_seller_id,
        sd.company_name,
        si.email
      FROM new_seller_details sd
      ${PRIMARY_SELLER_CONTACT}
      WHERE sd.id = $1
      `,
      [sellerId]
    ),
  ]);

  const seller = sellerRes.rows[0];
  if (!seller) throw new ServerError('Seller not found', 404, ErrorCode.NOT_FOUND);

  const to = String(seller.email || '').trim().toLowerCase();
  if (!to) {
    throw new ServerError(
      'This seller does not have an email address. Add email first.',
      400,
      ErrorCode.BAD_REQUEST
    );
  }

  const companyName = String(seller.company_name || seller.gem_seller_id || 'Seller').trim();
  const safeMessage = message.replace(/\n/g, '<br />');

  const html = `
    <div>
      <p>Hi ${companyName},</p>
      <p>${safeMessage}</p>
      <p>Regards,</p>
    </div>
  `;

  const text = `Hi ${companyName},\n\n${message}\n\nRegards,`;

  const sendResult = await Mail.send({
    to,
    subject,
    html,
    text,
  });

  if (!sendResult.success) {
    const reasonMessages = {
      missing_recipient: 'Recipient email is required',
      missing_subject: 'Email subject is required',
      missing_body: 'Email message is required',
      config: 'Email is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM in backend/.env',
      transport: sendResult.message || 'Failed to send email',
    };

    throw new ServerError(
      reasonMessages[sendResult.reason] || sendResult.message || 'Failed to send email',
      sendResult.reason === 'config' ? 400 : 500,
      sendResult.reason === 'config' ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL
    );
  }

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
    VALUES ($1, $2, $3, $4, $5, 'email-direct', $6::jsonb, $7)
    `,
    [
      seller.seller_uuid,
      seller.gem_seller_id || null,
      (companyName || '').slice(0, 255),
      to,
      subject,
      // Store the final message format (what the recipient received)
      JSON.stringify({ message: text }),
      req.user.id,
    ]
  );

  return res.status(201).json({
    message: 'Email sent successfully',
    seller_id: seller.seller_uuid,
    to,
    subject,
    message_id: sendResult.messageId || null,
  });
};

