const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const listBuyers = require('@/components/buyers/listBuyers');
const listBuyerCities = require('@/components/buyers/listBuyerCities');
const getBuyerById = require('@/components/buyers/getBuyerById');
const updateBuyerStatus = require('@/components/buyers/updateBuyerStatus');
const listBuyerStatusHistory = require('@/components/buyers/listBuyerStatusHistory');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(listBuyers.validationSchema), withDatabase(listBuyers.controller));

router
  .route('/cities')
  .get(validate(listBuyerCities.validationSchema), withDatabase(listBuyerCities.controller));

router
  .route('/:id/status')
  .patch(
    staffRequired,
    validate(updateBuyerStatus.validationSchema),
    withDatabase(updateBuyerStatus.controller)
  );

router
  .route('/:id/status-history')
  .get(
    validate(listBuyerStatusHistory.validationSchema),
    withDatabase(listBuyerStatusHistory.controller)
  );

router
  .route('/:id')
  .get(validate(getBuyerById.validationSchema), withDatabase(getBuyerById.controller));

module.exports = router;
