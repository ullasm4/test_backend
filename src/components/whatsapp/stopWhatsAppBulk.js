const { stopBulkJob } = require('@/service/whatsapp/bulkSender');

exports.validationSchema = {};

exports.controller = async (_req, res) => {
  const status = await stopBulkJob();
  return res.status(200).json({
    message: 'WhatsApp bulk messaging stopped',
    ...status,
  });
};
