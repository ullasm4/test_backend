const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const listEndUsers = require('@/components/endUsers/listEndUsers');
const getEndUserById = require('@/components/endUsers/getEndUserById');
const createEndUser = require('@/components/endUsers/createEndUser');
const updateEndUser = require('@/components/endUsers/updateEndUser');
const deleteEndUser = require('@/components/endUsers/deleteEndUser');
const assignSellers = require('@/components/endUsers/assignSellers');
const unassignSellers = require('@/components/endUsers/unassignSellers');
const listAssignedSellers = require('@/components/endUsers/listAssignedSellers');
const assignBuyers = require('@/components/endUsers/assignBuyers');
const unassignBuyers = require('@/components/endUsers/unassignBuyers');
const listAssignedBuyers = require('@/components/endUsers/listAssignedBuyers');

const router = express.Router();
router.use(authRequired);
router.use(staffRequired);

router
  .route('/')
  .get(validate(listEndUsers.validationSchema), withDatabase(listEndUsers.controller))
  .post(validate(createEndUser.validationSchema), withDatabase(createEndUser.controller));

router
  .route('/:id/assigned-sellers')
  .get(validate(listAssignedSellers.validationSchema), withDatabase(listAssignedSellers.controller));

router
  .route('/:id/assign-sellers')
  .post(validate(assignSellers.validationSchema), withDatabase(assignSellers.controller))
  .delete(validate(unassignSellers.validationSchema), withDatabase(unassignSellers.controller));

router
  .route('/:id/assigned-buyers')
  .get(validate(listAssignedBuyers.validationSchema), withDatabase(listAssignedBuyers.controller));

router
  .route('/:id/assign-buyers')
  .post(validate(assignBuyers.validationSchema), withDatabase(assignBuyers.controller))
  .delete(validate(unassignBuyers.validationSchema), withDatabase(unassignBuyers.controller));

router
  .route('/:id')
  .get(validate(getEndUserById.validationSchema), withDatabase(getEndUserById.controller))
  .put(validate(updateEndUser.validationSchema), withDatabase(updateEndUser.controller))
  .delete(validate(deleteEndUser.validationSchema), withDatabase(deleteEndUser.controller));

module.exports = router;
