const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const getEmailStatus = require('@/components/email/getEmailStatus');
const listEmailLogs = require('@/components/email/listEmailLogs');
const sendDirectEmail = require('@/components/email/sendDirectEmail');
const sendBrevoEmail = require('@/components/email/sendBrevoEmail');
const listBrevoTemplates = require('@/components/email/listBrevoTemplates');
const previewBrevoBulkEmail = require('@/components/email/previewBrevoBulkEmail');
const sendBrevoBulkEmail = require('@/components/email/sendBrevoBulkEmail');
const brevoWebhook = require('@/components/email/brevoWebhook');
const createWebhook = require('@/components/email/createWebhook');
const listBrevoWebhookLogs = require('@/components/email/listBrevoWebhookLogs');
const getBrevoEmailDetails = require('@/components/email/getBrevoEmailDetails');

const router = express.Router();

// Public Webhook receiver endpoint (No JWT auth required, as Brevo posts directly here)
router
  .route('/webhook')
  .post(validate(brevoWebhook.validationSchema), withDatabase(brevoWebhook.controller));

// Authenticated routes below
router.use(authRequired);

router
  .route('/webhook/register')
  .post(validate(createWebhook.validationSchema), withDatabase(createWebhook.controller));

router
  .route('/webhook/logs')
  .get(validate(listBrevoWebhookLogs.validationSchema), withDatabase(listBrevoWebhookLogs.controller));

router
  .route('/brevo-details')
  .get(validate(getBrevoEmailDetails.validationSchema), withDatabase(getBrevoEmailDetails.controller));

router
  .route('/status')
  .get(validate(getEmailStatus.validationSchema), withDatabase(getEmailStatus.controller));

router
  .route('/logs')
  .get(validate(listEmailLogs.validationSchema), withDatabase(listEmailLogs.controller));

router
  .route('/send-direct')
  .post(validate(sendDirectEmail.validationSchema), withDatabase(sendDirectEmail.controller));

router
  .route('/brevo-templates')
  .get(validate(listBrevoTemplates.validationSchema), withDatabase(listBrevoTemplates.controller));

router
  .route('/brevo-bulk-preview')
  .get(validate(previewBrevoBulkEmail.validationSchema), withDatabase(previewBrevoBulkEmail.controller));

router
  .route('/send-brevo')
  .post(validate(sendBrevoEmail.validationSchema), withDatabase(sendBrevoEmail.controller));

router
  .route('/send-brevo-bulk')
  .post(validate(sendBrevoBulkEmail.validationSchema), withDatabase(sendBrevoBulkEmail.controller));

module.exports = router;
