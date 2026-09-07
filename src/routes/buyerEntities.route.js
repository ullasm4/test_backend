const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const listBuyerEntities = require('@/components/buyerEntities/listBuyerEntities');

const router = express.Router();
router.use(authRequired);
router.use(staffRequired);

router
  .route('/')
  .get(validate(listBuyerEntities.validationSchema), withDatabase(listBuyerEntities.controller));

module.exports = router;
