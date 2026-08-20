const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listContracts = require('@/components/contracts/listContracts');
const getContractById = require('@/components/contracts/getContractById');
const listMinistries = require('@/components/contracts/listMinistries');
const listContractLookups = require('@/components/contracts/listContractLookups');

const router = express.Router();
router.use(authRequired);

router
  .route('/ministries')
  .get(validate(listMinistries.validationSchema), withDatabase(listMinistries.controller));

router
  .route('/lookups/:kind')
  .get(validate(listContractLookups.validationSchema), withDatabase(listContractLookups.controller));

router
  .route('/')
  .get(validate(listContracts.validationSchema), withDatabase(listContracts.controller));

router
  .route('/:id')
  .get(validate(getContractById.validationSchema), withDatabase(getContractById.controller));

module.exports = router;
