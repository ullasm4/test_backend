const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listSellers = require('@/components/sellers/listSellers');
const getSellerById = require('@/components/sellers/getSellerById');
const getSellerContracts = require('@/components/sellers/getSellerContracts');
const getSellerCategories = require('@/components/sellers/getSellerCategories');
const syncSellerCategories = require('@/components/sellers/syncSellerCategories');
const sendSellerEmail = require('@/components/sellers/sendSellerEmail');
const listSellerEmailLogs = require('@/components/sellers/listSellerEmailLogs');
const sendSellerWhatsApp = require('@/components/sellers/sendSellerWhatsApp');
const listSellerWhatsAppLogs = require('@/components/sellers/listSellerWhatsAppLogs');
const listCategories = require('@/components/sellers/listCategories');
const getCategorySellers = require('@/components/sellers/getCategorySellers');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(listSellers.validationSchema), withDatabase(listSellers.controller));

router
  .route('/categories/list')
  .get(validate(listCategories.validationSchema), withDatabase(listCategories.controller));

router
  .route('/categories/sellers')
  .get(validate(getCategorySellers.validationSchema), withDatabase(getCategorySellers.controller));

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
  .route('/:id/sync-categories')
  .post(validate(syncSellerCategories.validationSchema), withDatabase(syncSellerCategories.controller));

router
  .route('/:id/send-email')
  .post(validate(sendSellerEmail.validationSchema), withDatabase(sendSellerEmail.controller));

router
  .route('/:id/email-logs')
  .get(validate(listSellerEmailLogs.validationSchema), withDatabase(listSellerEmailLogs.controller));

router
  .route('/:id/send-whatsapp')
  .post(validate(sendSellerWhatsApp.validationSchema), withDatabase(sendSellerWhatsApp.controller));

router
  .route('/:id/whatsapp-logs')
  .get(validate(listSellerWhatsAppLogs.validationSchema), withDatabase(listSellerWhatsAppLogs.controller));

module.exports = router;
