const express = require("express");
const multer = require("multer");
const path = require("path");
const { uploadPrescriptionToS3 } = require("../services/s3PrescriptionUpload");

const router = express.Router();

const prescriptionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMime = /^(image\/(jpeg|jpg|pjpeg|png|gif|webp|heic|heif)|application\/pdf)$/i;
    if (allowedMime.test(file.mimetype || "")) return cb(null, true);
    const ext = (path.extname(file.originalname || "") || "").toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".pdf"].includes(ext)) {
      return cb(null, true);
    }
    return cb(new Error("Only images or PDF files are allowed."), false);
  },
});

router.post("/prescription", prescriptionUpload.single("file"), async (req, res) => {
  try {
    const rawUserId = req.query?.userId || req.query?.user_id || req.body?.userId || req.body?.user_id;
    const uploaded = await uploadPrescriptionToS3({ file: req.file, userId: rawUserId });
    return res.status(201).json({
      success: true,
      url: uploaded.url,
      key: uploaded.key,
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, error: "File too large. Max 5 MB." });
    }
    if (err.message && err.message.includes("Only images or PDF")) {
      return res.status(400).json({ success: false, error: err.message });
    }
    return res.status(500).json({ success: false, error: err.message || "Upload failed" });
  }
});

module.exports = router;
