const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const getEmailStatus = require('@/components/email/getEmailStatus');
const listEmailLogs = require('@/components/email/listEmailLogs');
const sendDirectEmail = require('@/components/email/sendDirectEmail');

const router = express.Router();
router.use(authRequired);

router
  .route('/status')
  .get(validate(getEmailStatus.validationSchema), withDatabase(getEmailStatus.controller));

router
  .route('/logs')
  .get(validate(listEmailLogs.validationSchema), withDatabase(listEmailLogs.controller));

router
  .route('/send-direct')
  .post(validate(sendDirectEmail.validationSchema), withDatabase(sendDirectEmail.controller));

module.exports = router;
