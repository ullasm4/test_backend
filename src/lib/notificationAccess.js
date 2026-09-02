function isNotificationAdmin(user) {
  return user?.role === 'admin';
}

function buildNotificationAccessConditions(user, { tableAlias = 'n', paramOffset = 0 } = {}) {
  if (isNotificationAdmin(user)) {
    return { conditions: [], params: [] };
  }

  const userParam = `$${paramOffset + 1}`;
  return {
    conditions: [
      `${tableAlias}.seller_id IN (
        SELECT uas.seller_id
        FROM user_assign_sellers uas
        WHERE uas.user_id = ${userParam}
      )`,
    ],
    params: [user.id],
  };
}

function buildNotificationFilter(user, { unreadOnly = false, tableAlias = 'n' } = {}) {
  const { conditions, params } = buildNotificationAccessConditions(user, { tableAlias });

  if (unreadOnly) {
    conditions.push(`${tableAlias}.is_read = FALSE`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

module.exports = {
  isNotificationAdmin,
  buildNotificationAccessConditions,
  buildNotificationFilter,
};
