const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.route'));
router.use('/dashboard', require('./dashboard.route'));
router.use('/users', require('./users.route'));
router.use('/contracts', require('./contracts.route'));
router.use('/sellers', require('./sellers.route'));
router.use('/buyers', require('./buyers.route'));
router.use('/whatsapp', require('./whatsapp.route'));
router.use('/email', require('./email.route'));

module.exports = router;
