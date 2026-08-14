const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const env = require('@/config/env');
const ServerError = require('@/utils/ServerError');
const ErrorCode = require('@/config/errorCode');
const { uploadDumpFile } = require('@/service/s3');

exports.validationSchema = {
  body: Joi.object({
    password: Joi.string().required(),
  }),
};

async function verifyPassword(password, userId, db) {
  if (env.DUMP_RESTORE_PASSWORD && password === env.DUMP_RESTORE_PASSWORD) {
    return true;
  }

  const { rows } = await db.query(
    `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = rows[0];

  if (user?.password_hash) {
    return bcrypt.compare(password, user.password_hash);
  }

  return false;
}

function formatDumpFileName(date = new Date()) {
  const timestamp = date
    .toISOString()
    .replace('T', '_')
    .replace(/:/g, '-')
    .replace('.', '-');

  return `db_dump_${timestamp}.sql`;
}

function runDumpScript(dumpFilePath) {
  const scriptPath = path.join(__dirname, '../../../bash/databaseDumpOnly.sh');
  const rootDir = path.join(__dirname, '../../..');

  return new Promise((resolve, reject) => {
    exec(
      `bash "${scriptPath}" "${dumpFilePath}"`,
      {
        cwd: rootDir,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          SRC_DB_HOST: env.DB_HOST || 'localhost',
          SRC_DB_PORT: String(env.DB_PORT || 5432),
          SRC_DB_NAME: env.DB_NAME || 'contract_management',
          SRC_DB_USER: env.DB_USER || 'postgres',
          SRC_DB_PASSWORD: env.DB_PASSWORD || '',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          return reject(
            new ServerError(
              `Database dump failed: ${stderr || error.message}`,
              500,
              ErrorCode.INTERNAL
            )
          );
        }

        console.log('Database dump script output:\n', stdout);
        resolve(stdout);
      }
    );
  });
}

exports.controller = async (req, res, _next, db) => {
  const { password } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    throw new ServerError('Authentication required', 401, ErrorCode.UNAUTHORIZED);
  }

  const isPasswordValid = await verifyPassword(password, userId, db);
  if (!isPasswordValid) {
    throw new ServerError('Incorrect password', 400, ErrorCode.BAD_REQUEST);
  }

  const dumpFileName = formatDumpFileName();
  const dumpFilePath = path.join(__dirname, '../../../tmp', dumpFileName);

  try {
    await runDumpScript(dumpFilePath);

    const s3Key = `${env.S3_DUMP_PREFIX}/${dumpFileName}`;
    const url = await uploadDumpFile({
      key: s3Key,
      filePath: dumpFilePath,
      contentType: 'application/sql',
    });

    res.status(200).json({
      success: true,
      message: 'Database dump uploaded to S3 successfully!',
      bucket: env.S3_DUMP_BUCKET,
      key: s3Key,
      url,
    });
  } finally {
    if (fs.existsSync(dumpFilePath)) {
      fs.unlinkSync(dumpFilePath);
    }
  }
};
