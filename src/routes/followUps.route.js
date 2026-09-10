const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired, staffRequired } = require('@/middleware/auth');
const listFollowUps = require('@/components/followUps/listFollowUps');
const listFollowUpCreators = require('@/components/followUps/listFollowUpCreators');
const deleteFollowUp = require('@/components/followUps/deleteFollowUp');

const router = express.Router();

router.use(authRequired);
router.use(staffRequired);

router
  .route('/')
  .get(validate(listFollowUps.validationSchema), withDatabase(listFollowUps.controller));

router
  .route('/creators')
  .get(
    validate(listFollowUpCreators.validationSchema),
    withDatabase(listFollowUpCreators.controller)
  );

router
  .route('/:id')
  .delete(validate(deleteFollowUp.validationSchema), withDatabase(deleteFollowUp.controller));

module.exports = router;
