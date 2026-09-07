const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const login = require('@/components/auth/login');
const me = require('@/components/auth/me');
const endUserLogin = require('@/components/auth/endUserLogin');
const endUserMe = require('@/components/auth/endUserMe');

const router = express.Router();

router.route('/login').post(validate(login.validationSchema), withDatabase(login.controller));
router.route('/me').get(authRequired, validate(me.validationSchema), withDatabase(me.controller));

router
  .route('/end-user/login')
  .post(validate(endUserLogin.validationSchema), withDatabase(endUserLogin.controller));
router
  .route('/end-user/me')
  .get(authRequired, validate(endUserMe.validationSchema), withDatabase(endUserMe.controller));

module.exports = router;
