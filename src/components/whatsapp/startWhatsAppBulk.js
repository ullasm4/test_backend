const Joi = require('joi');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { startBulkJob } = require('@/service/whatsapp/bulkSender');

exports.validationSchema = {
  body: Joi.object({
    daily_limit: Joi.number().integer().min(1).max(10000).required(),
  }),
};

function mapBulkError(error) {
  if (error?.code === 'ALREADY_RUNNING') {
    throw new ServerError(error.message, 400, ErrorCode.BAD_REQUEST);
  }
  if (
    error?.code === 'CONFIG'
    || error?.code === 'NO_ELIGIBLE'
    || error?.code === 'LIMIT_EXCEEDS_REMAINING'
  ) {
    throw new ServerError(error.message, 400, ErrorCode.BAD_REQUEST);
  }
  throw error;
}

exports.controller = async (req, res) => {
  if (!req.user?.id) {
    throw new ServerError('Login required', 401, ErrorCode.UNAUTHORIZED);
  }

  try {
    const status = await startBulkJob({
      dailyLimit: req.body.daily_limit,
      startedBy: req.user.id,
    });
    return res.status(201).json({
      message: 'WhatsApp bulk messaging started',
      ...status,
    });
  } catch (error) {
    mapBulkError(error);
    return undefined;
  }
};
