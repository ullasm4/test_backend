const { pool } = require('@/service/db');

/**
 * Injects pg pool as 4th arg: controller(req, res, next, db)
 */
function withDatabase(controller) {
  return async (req, res, next) => {
    try {
      await controller(req, res, next, pool);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = withDatabase;
