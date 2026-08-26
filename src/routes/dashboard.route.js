const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const getDashboard = require('@/components/dashboard/getDashboard');
const dumpAndRestore = require('@/components/dashboard/dumpAndRestore');
const dumpToS3 = require('@/components/dashboard/dumpToS3');
const recalculateSellerTotalValue = require('@/components/dashboard/recalculateSellerTotalValue');
const syncAllSellerCategories = require('@/components/dashboard/syncAllSellerCategories');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(getDashboard.validationSchema), withDatabase(getDashboard.controller));

router
  .route('/dump-restore')
  .post(validate(dumpAndRestore.validationSchema), withDatabase(dumpAndRestore.controller));

router
  .route('/dump-s3')
  .post(validate(dumpToS3.validationSchema), withDatabase(dumpToS3.controller));

router
  .route('/recalculate-seller-total-value')
  .post(
    validate(recalculateSellerTotalValue.validationSchema),
    withDatabase(recalculateSellerTotalValue.controller)
  );

router
  .route('/sync-seller-categories')
  .post(
    validate(syncAllSellerCategories.validationSchema),
    withDatabase(syncAllSellerCategories.controller)
  );

module.exports = router;

