const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "../../.env"),
});

const env = {
  NODE_ENV: process.env.NODE_ENV || "dev",
  SERVICE_NAME: process.env.SERVICE_NAME || "backend",
  SERVER_PORT: Number(process.env.SERVER_PORT || process.env.PORT || 3008),

  JWT_SECRET: process.env.JWT_SECRET || "test@token_123",

  // Database
  DATABASE_URL: process.env.DATABASE_URL,

  DB_HOST: process.env.DB_HOST,
  DB_PORT: Number(process.env.DB_PORT || 5432),
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,

  DB_SSL: process.env.DB_SSL === "true",
};

module.exports = env;
