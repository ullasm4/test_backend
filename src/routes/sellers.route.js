const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listSellers = require('@/components/sellers/listSellers');
const getSellerById = require('@/components/sellers/getSellerById');
const getSellerContracts = require('@/components/sellers/getSellerContracts');
const getSellerCategories = require('@/components/sellers/getSellerCategories');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(listSellers.validationSchema), withDatabase(listSellers.controller));

router
  .route('/:id')
  .get(validate(getSellerById.validationSchema), withDatabase(getSellerById.controller));

router
  .route('/:id/contracts')
  .get(validate(getSellerContracts.validationSchema), withDatabase(getSellerContracts.controller));

router
  .route('/:id/categories')
  .get(validate(getSellerCategories.validationSchema), withDatabase(getSellerCategories.controller));

module.exports = router;
