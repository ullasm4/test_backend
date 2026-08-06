const { Pool, types } = require("pg");
const env = require("../config/env");

types.setTypeParser(types.builtins.DATE, (val) => val);
types.setTypeParser(
  types.builtins.NUMERIC,
  (val) => (val === null ? null : Number(val))
);

console.log("PostgreSQL Config:", {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  ssl: env.DB_SSL,
});

const pool = new Pool({
  host: env.DB_HOST,
  port: parseInt(env.DB_PORT || "5432", 10),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: parseInt(env.DB_POOL_MAX || "25", 10),
  idleTimeoutMillis: parseInt(env.DB_IDLE_TIMEOUT || "30000", 10),
  connectionTimeoutMillis: parseInt(env.DB_CONN_TIMEOUT || "5000", 10),
  ssl:
    env.DB_SSL === "true" || env.DB_SSL === true
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("connect", () => {
  console.log("✅ Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL Pool Error:", err);
});

module.exports = { pool };
