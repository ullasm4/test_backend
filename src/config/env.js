const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "../../.env"),
});

const env = {
  NODE_ENV: process.env.NODE_ENV || "dev",
  SERVICE_NAME: process.env.SERVICE_NAME || "backend",
  SERVER_PORT: Number(process.env.SERVER_PORT || process.env.PORT || 3008),

  JWT_SECRET: process.env.JWT_SECRET || "test@token_123",
  DUMP_RESTORE_PASSWORD: process.env.DUMP_RESTORE_PASSWORD || "harshil@2812",


  // Database
  DATABASE_URL: process.env.DATABASE_URL,

  DB_HOST: process.env.DB_HOST,
  DB_PORT: Number(process.env.DB_PORT || 5432),
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,

  DB_SSL: process.env.DB_SSL === "true",

  // AWS (primary — e.g. contract PDFs / migration source)
  AWS_REGION: process.env.AWS_REGION || "ap-south-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,

  // S3 database dump (backup account — contracts-information bucket)
  S3_DUMP_REGION:
    process.env.AWS_REGION_BACKUP || process.env.AWS_REGION || "ap-south-1",
  S3_DUMP_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID_BACKUP,
  S3_DUMP_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY_BACKUP,
  S3_DUMP_BUCKET:
    process.env.S3_BUCKET_NAME_BACKUP ||
    process.env.S3_DUMP_BUCKET ||
    "contracts-information",
  S3_DUMP_PREFIX: (process.env.S3_DUMP_PREFIX || "backup").replace(/^\/+|\/+$/g, ""),

  WHATSAPP_SERVICE_API_KEY: process.env.WHATSAPP_SERVICE_API_KEY || "",
  WHATSAPP_API_URL:
    process.env.WHATSAPP_API_URL ||
    "https://backend.aisensy.com/campaign/t1/api/v2",
  WHATSAPP_CAMPAIGN_NAME: process.env.WHATSAPP_CAMPAIGN_NAME || "T1",
  WHATSAPP_USER_NAME:
    process.env.WHATSAPP_USER_NAME || "PRIVATE E- MARKETPLACE",
  WHATSAPP_SOURCE: process.env.WHATSAPP_SOURCE || "contract-desk",
  WHATSAPP_MEDIA_URL: process.env.WHATSAPP_MEDIA_URL || "",
  WHATSAPP_MEDIA_FILENAME: process.env.WHATSAPP_MEDIA_FILENAME || "sample_media",
};

module.exports = env;
