const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'dev',
  SERVICE_NAME: process.env.SERVICE_NAME || 'backend',
  SERVER_PORT: Number(process.env.SERVER_PORT || process.env.PORT || 3008),
  JWT_SECRET: process.env.JWT_SECRET || 'test@token_123',
  DATABASE_URL: process.env.DATABASE_URL,
  DB_SSL: process.env.DB_SSL === 'true',
};

module.exports = env;
