const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const getStateWiseContractCounts = require('@/components/settings/getStateWiseContractCounts');

const router = express.Router();
router.use(authRequired);
router.use(staffRequired);

router
  .route('/state-contract-counts')
  .get(
    validate(getStateWiseContractCounts.validationSchema),
    withDatabase(getStateWiseContractCounts.controller)
  );

module.exports = router;
