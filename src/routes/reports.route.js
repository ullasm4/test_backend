const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const getUserStatusReport = require('@/components/reports/getUserStatusReport');
const getUserStatusDetails = require('@/components/reports/getUserStatusDetails');

const getUserDailyStatusReport = require('@/components/reports/getUserDailyStatusReport');

const router = express.Router();
router.use(authRequired);
router.use(staffRequired);

router
  .route('/user-monthly-status')
  .get(
    validate(getUserStatusReport.validationSchema),
    withDatabase(getUserStatusReport.controller)
  );

router
  .route('/user-daily-status')
  .get(
    validate(getUserDailyStatusReport.validationSchema),
    withDatabase(getUserDailyStatusReport.controller)
  );

router
  .route('/user-status-details')
  .get(
    validate(getUserStatusDetails.validationSchema),
    withDatabase(getUserStatusDetails.controller)
  );

module.exports = router;
