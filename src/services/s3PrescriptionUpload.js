const path = require("path");
const { S3_PRESCRIPTION_PREFIX, S3_PUBLIC_BASE_URL } = require("../config");

let s3Client = null;

function ensureS3Env() {
  const required = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "S3_BUCKET"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing S3 env: ${missing.join(", ")}`);
  }
}

function getAwsSdk() {
  try {
    return {
      ...require("@aws-sdk/client-s3"),
      ...require("@aws-sdk/s3-request-presigner"),
    };
  } catch (_) {
    throw new Error("AWS SDK packages are not installed. Run npm install in backend-erp.");
  }
}

function getS3Client() {
  ensureS3Env();
  if (s3Client) return s3Client;
  const { S3Client } = getAwsSdk();
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

function resolveMimeType(fileMimetype, extFromName) {
  const ext = (extFromName || "").toLowerCase();
  const normalizedMime = (fileMimetype || "").toLowerCase();
  if (normalizedMime === "application/pdf" || ext === ".pdf") return "application/pdf";
  if (normalizedMime.startsWith("image/")) return normalizedMime;
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".heif") return "image/heif";
  return "image/jpeg";
}

async function uploadPrescriptionToS3({ file, userId }) {
  const rawUserId = (userId || "").toString().trim();
  if (!rawUserId) throw new Error("Missing userId.");
  if (!file || !file.buffer) throw new Error('No file uploaded. Use field name "file".');

  const { PutObjectCommand, GetObjectCommand, getSignedUrl } = getAwsSdk();
  const client = getS3Client();
  const safeUserId = rawUserId.replace(/\//g, "-");
  const extFromName = (path.extname(file.originalname || "") || "").toLowerCase();
  const isPdf = (file.mimetype || "").toLowerCase() === "application/pdf" || extFromName === ".pdf";
  const mime = resolveMimeType(file.mimetype, extFromName);
  const originalBaseName = path.basename(file.originalname || `prescription-${Date.now()}`, extFromName);
  const safeBaseName = originalBaseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = isPdf ? ".pdf" : extFromName || ".jpg";
  const key = `${S3_PRESCRIPTION_PREFIX}/${safeUserId}/${Date.now()}_${safeBaseName}${ext}`;

  await client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: mime,
  }));

  const url = S3_PUBLIC_BASE_URL
    ? `${S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`
    : await getSignedUrl(client, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
      expiresIn: 60 * 60 * 24 * 6,
    });

  return { key, url };
}

module.exports = { uploadPrescriptionToS3 };
