const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const getDashboard = require('@/components/dashboard/getDashboard');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(getDashboard.validationSchema), withDatabase(getDashboard.controller));

module.exports = router;
