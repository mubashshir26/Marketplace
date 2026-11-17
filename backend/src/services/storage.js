const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const newName = (file) => `${crypto.randomUUID()}${EXT[file.mimetype]}`;

// STORAGE=local (default): files go to backend/uploads and are served at /uploads.
async function saveLocal(file) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = newName(file);
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  const base = (process.env.PUBLIC_URL || 'http://localhost:5000').replace(/\/$/, '');
  return `${base}/uploads/${name}`;
}

// STORAGE=s3: credentials are read from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env.
// The bucket must allow public reads for these URLs to load in the browser.
async function saveS3(file) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET;
  if (!region || !bucket) throw new Error('AWS_REGION and AWS_S3_BUCKET must be set for STORAGE=s3');

  const key = `products/${newName(file)}`;
  await new S3Client({ region }).send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: file.buffer, ContentType: file.mimetype })
  );
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

const saveImage = (file) => (process.env.STORAGE === 's3' ? saveS3(file) : saveLocal(file));

module.exports = { saveImage, UPLOAD_DIR };