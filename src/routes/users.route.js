const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listUsers = require('@/components/users/listUsers');
const getUserById = require('@/components/users/getUserById');
const createUser = require('@/components/users/createUser');
const updateUser = require('@/components/users/updateUser');
const deleteUser = require('@/components/users/deleteUser');
const assignSellers = require('@/components/users/assignSellers');
const unassignSellers = require('@/components/users/unassignSellers');
const listAssignedSellers = require('@/components/users/listAssignedSellers');

const router = express.Router();
router.use(authRequired);

router
  .route('/')
  .get(validate(listUsers.validationSchema), withDatabase(listUsers.controller))
  .post(validate(createUser.validationSchema), withDatabase(createUser.controller));

router
  .route('/:id/assigned-sellers')
  .get(validate(listAssignedSellers.validationSchema), withDatabase(listAssignedSellers.controller));

router
  .route('/:id/assign-sellers')
  .post(validate(assignSellers.validationSchema), withDatabase(assignSellers.controller))
  .delete(validate(unassignSellers.validationSchema), withDatabase(unassignSellers.controller));

router
  .route('/:id')
  .get(validate(getUserById.validationSchema), withDatabase(getUserById.controller))
  .put(validate(updateUser.validationSchema), withDatabase(updateUser.controller))
  .delete(validate(deleteUser.validationSchema), withDatabase(deleteUser.controller));

module.exports = router;
