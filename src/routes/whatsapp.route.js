const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const startWhatsAppBulk = require('@/components/whatsapp/startWhatsAppBulk');
const stopWhatsAppBulk = require('@/components/whatsapp/stopWhatsAppBulk');
const getWhatsAppBulkStatus = require('@/components/whatsapp/getWhatsAppBulkStatus');
const listWhatsAppLogs = require('@/components/whatsapp/listWhatsAppLogs');
const sendDirectWhatsApp = require('@/components/whatsapp/sendDirectWhatsApp');
const sendDirectEmail = require('@/components/email/sendDirectEmail');

const router = express.Router();
router.use(authRequired);

router
  .route('/bulk/start')
  .post(validate(startWhatsAppBulk.validationSchema), withDatabase(startWhatsAppBulk.controller));

router
  .route('/bulk/stop')
  .post(validate(stopWhatsAppBulk.validationSchema), withDatabase(stopWhatsAppBulk.controller));

router
  .route('/bulk/status')
  .get(validate(getWhatsAppBulkStatus.validationSchema), withDatabase(getWhatsAppBulkStatus.controller));

router
  .route('/send-direct')
  .post(validate(sendDirectWhatsApp.validationSchema), withDatabase(sendDirectWhatsApp.controller));

router
  .route('/send-direct-email')
  .post(validate(sendDirectEmail.validationSchema), withDatabase(sendDirectEmail.controller));

router
  .route('/logs')
  .get(validate(listWhatsAppLogs.validationSchema), withDatabase(listWhatsAppLogs.controller));

module.exports = router;
