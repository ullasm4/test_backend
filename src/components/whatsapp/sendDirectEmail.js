const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const Mail = require('@/service/mail');

exports.validationSchema = {
  body: Joi.object({
    company_name: Joi.string().trim().min(1).max(255).required(),
    email: Joi.string().trim().email({ tlds: { allow: false } }).max(255).required(),
    subject: Joi.string().trim().min(1).max(255).required(),
    message: Joi.string().trim().min(1).max(10000).required(),
  }),
};

exports.controller = async (req, res) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to send email', 401, ErrorCode.UNAUTHORIZED);
  }

  const companyName = String(req.body.company_name || '').trim();
  const to = String(req.body.email || '').trim().toLowerCase();
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();

  const html = `
    <div>
      <p>Hello ${companyName},</p>
      <p>${message.replace(/\n/g, '<br />')}</p>
    </div>
  `;

  const sendResult = await Mail.send({
    to,
    subject,
    html,
    text: `Hello ${companyName},\n\n${message}`,
  });

  if (!sendResult.success) {
    const reasonMessages = {
      missing_recipient: 'Recipient email is required',
      missing_subject: 'Email subject is required',
      missing_body: 'Email body is required',
      config: 'Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in backend/.env',
      transport: sendResult.message || 'Failed to send email',
    };
    throw new ServerError(
      reasonMessages[sendResult.reason] || 'Failed to send email',
      sendResult.reason === 'config' ? 400 : 500,
      sendResult.reason === 'config' ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL
    );
  }

  return res.status(201).json({
    message: 'Email sent successfully',
    company_name: companyName,
    email: to,
    subject,
    message_id: sendResult.messageId || null,
  });
};
