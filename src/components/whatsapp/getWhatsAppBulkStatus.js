const { getBulkStatus } = require('@/service/whatsapp/bulkSender');

exports.validationSchema = {};

exports.controller = async (_req, res) => {
  const status = await getBulkStatus();
  return res.status(200).json(status);
};
