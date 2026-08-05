const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listSellers = require('@/components/sellers/listSellers');
const getSellerById = require('@/components/sellers/getSellerById');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(listSellers.validationSchema), withDatabase(listSellers.controller));

router
  .route('/:id')
  .get(validate(getSellerById.validationSchema), withDatabase(getSellerById.controller));

module.exports = router;
