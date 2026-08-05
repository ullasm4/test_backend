const Joi = require('joi');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const path = require('path');
const env = require('@/config/env');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');

exports.validationSchema = {
  body: Joi.object({
    password: Joi.string().required(),
  }),
};

exports.controller = async (req, res, _next, db) => {
  const { password } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    throw new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED);
  }

  // 1. Verify password against backend env setting (or user password)
  let isPasswordValid = false;

  if (env.DUMP_RESTORE_PASSWORD && password === env.DUMP_RESTORE_PASSWORD) {
    isPasswordValid = true;
  } else {
    const { rows } = await db.query(
      `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    const user = rows[0];
    if (user && user.password_hash) {
      isPasswordValid = await bcrypt.compare(password, user.password_hash);
    }
  }

  if (!isPasswordValid) {
    throw new ServerError('Incorrect password', 400, ErrorCode.BAD_REQUEST);
  }

  // 2. Execute optimized combined dump and restore bash script
  const scriptPath = path.join(__dirname, '../../../bash/dumpAndRestore.sh');

  return new Promise((resolve, reject) => {
    exec(
      `bash "${scriptPath}"`,
      { cwd: path.join(__dirname, '../../..'), maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error('Error executing dump and restore script:', error, stderr);
          return reject(
            new ServerError(
              `Database dump & restore failed: ${stderr || error.message}`,
              500,
              ErrorCode.INTERNAL
            )
          );
        }

        console.log('Dump and restore script output:\n', stdout);
        res.status(200).json({
          success: true,
          message: 'Database dump and restore completed successfully!',
          details: stdout,
        });
        resolve();
      }
    );
  });
};
