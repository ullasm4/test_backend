const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const login = require('@/components/auth/login');
const me = require('@/components/auth/me');

const router = express.Router();

router.route('/login').post(validate(login.validationSchema), withDatabase(login.controller));

router.route('/me').get(authRequired, validate(me.validationSchema), withDatabase(me.controller));

module.exports = router;
