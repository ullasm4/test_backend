const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { createWebhook } = require('@/service/mail/brevoService');

exports.validationSchema = {
  body: Joi.object({
    url: Joi.string().trim().uri({ scheme: ['http', 'https'] }).required(),
    events: Joi.array().items(Joi.string().trim()).optional(),
    description: Joi.string().trim().max(255).optional(),
    type: Joi.string().valid('transactional', 'marketing').default('transactional'),
  }),
};

exports.controller = async (req, res, _next) => {
  if (!req.user?.id) {
    throw new ServerError('Login required to register webhooks', 401, ErrorCode.UNAUTHORIZED);
  }

  const { url, events, description, type } = req.body;

  let result;
  try {
    result = await createWebhook({
      url,
      events,
      description,
      type,
    });
  } catch (err) {
    throw new ServerError(
      err.message || 'Failed to create Brevo webhook',
      502,
      ErrorCode.BAD_REQUEST
    );
  }

  return res.status(201).json({
    success: true,
    message: 'Brevo webhook created successfully',
    webhookId: result.id,
    data: result.data,
  });
};
