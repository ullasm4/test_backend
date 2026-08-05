const { Pool, types } = require('pg');
const env = require('../config/env');

types.setTypeParser(types.builtins.DATE, (val) => val);
types.setTypeParser(types.builtins.NUMERIC, (val) => (val === null ? null : Number(val)));

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
