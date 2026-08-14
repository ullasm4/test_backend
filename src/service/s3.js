const fs = require('fs');
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const env = require('@/config/env');

function createS3Client() {
  const config = { region: env.AWS_REGION };

  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return new S3Client(config);
}

function createDumpS3Client() {
  const config = { region: env.S3_DUMP_REGION };

  if (env.S3_DUMP_ACCESS_KEY_ID && env.S3_DUMP_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: env.S3_DUMP_ACCESS_KEY_ID,
      secretAccessKey: env.S3_DUMP_SECRET_ACCESS_KEY,
    };
  }

  return new S3Client(config);
}

async function uploadFile({ bucket, key, filePath, contentType = 'application/gzip' }) {
  const client = createS3Client();
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    },
  });

  await upload.done();
  return `https://${bucket}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
}

async function uploadDumpFile({ key, filePath, contentType = 'application/sql' }) {
  const client = createDumpS3Client();
  const bucket = env.S3_DUMP_BUCKET;
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    },
  });

  await upload.done();
  return `https://${bucket}.s3.${env.S3_DUMP_REGION}.amazonaws.com/${key}`;
}

module.exports = {
  createS3Client,
  createDumpS3Client,
  uploadFile,
  uploadDumpFile,
};
