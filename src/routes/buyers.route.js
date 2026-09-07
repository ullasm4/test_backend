const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listBuyers = require('@/components/buyers/listBuyers');
const listBuyerCities = require('@/components/buyers/listBuyerCities');
const getBuyerById = require('@/components/buyers/getBuyerById');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(listBuyers.validationSchema), withDatabase(listBuyers.controller));

router
  .route('/cities')
  .get(validate(listBuyerCities.validationSchema), withDatabase(listBuyerCities.controller));

router
  .route('/:id')
  .get(validate(getBuyerById.validationSchema), withDatabase(getBuyerById.controller));

module.exports = router;
