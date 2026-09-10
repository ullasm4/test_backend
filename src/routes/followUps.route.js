const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const listFollowUps = require('@/components/followUps/listFollowUps');

const router = express.Router();

router.use(authRequired);
router.use(staffRequired);

router
  .route('/')
  .get(validate(listFollowUps.validationSchema), withDatabase(listFollowUps.controller));

module.exports = router;
