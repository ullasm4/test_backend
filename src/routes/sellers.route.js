const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listSellers = require('@/components/sellers/listSellers');
const getSellerById = require('@/components/sellers/getSellerById');
const getSellerContracts = require('@/components/sellers/getSellerContracts');
const getSellerCategories = require('@/components/sellers/getSellerCategories');
const sendSellerEmail = require('@/components/sellers/sendSellerEmail');
const listSellerEmailLogs = require('@/components/sellers/listSellerEmailLogs');

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

router
  .route('/:id/send-email')
  .post(validate(sendSellerEmail.validationSchema), withDatabase(sendSellerEmail.controller));

router
  .route('/:id/email-logs')
  .get(validate(listSellerEmailLogs.validationSchema), withDatabase(listSellerEmailLogs.controller));

module.exports = router;
