const express = require('express');
const withDatabase = require('@/utils/withDatabase');
const { validate } = require('@/utils/validationHelper');
const { authRequired } = require('@/middleware/auth');
const listNotifications = require('@/components/notifications/listNotifications');
const getNotificationUnreadCount = require('@/components/notifications/getNotificationUnreadCount');
const markNotificationRead = require('@/components/notifications/markNotificationRead');
const markAllNotificationsRead = require('@/components/notifications/markAllNotificationsRead');

const router = express.Router();

router.use(authRequired);

router
  .route('/')
  .get(validate(listNotifications.validationSchema), withDatabase(listNotifications.controller));

router
  .route('/unread-count')
  .get(validate(getNotificationUnreadCount.validationSchema), withDatabase(getNotificationUnreadCount.controller));

router
  .route('/read-all')
  .patch(validate(markAllNotificationsRead.validationSchema), withDatabase(markAllNotificationsRead.controller));

router
  .route('/:id/read')
  .patch(validate(markNotificationRead.validationSchema), withDatabase(markNotificationRead.controller));

module.exports = router;
