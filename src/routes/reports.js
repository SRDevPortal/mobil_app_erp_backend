const express = require("express");
const { APP_ERP_TOKEN, REPORTS_OCR_TOKEN } = require("../config");
const { extractReportWithOpenAI, normalizeReportType } = require("../services/reportOcr");

const router = express.Router();

function safeEqualText(a, b) {
  const left = (a || "").toString();
  const right = (b || "").toString();
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

function requireReportsToken(req, res, next) {
  const supplied = req.get("x-reports-ocr-token") || req.get("x-erp-token") || "";
  const expected = REPORTS_OCR_TOKEN || APP_ERP_TOKEN;
  if (!expected) return res.status(503).json({ success: false, message: "REPORTS_OCR_TOKEN is not configured" });
  if (!safeEqualText(supplied, expected)) return res.status(401).json({ success: false, message: "Unauthorized" });
  return next();
}

router.post("/extract", requireReportsToken, async (req, res) => {
  const reportType = normalizeReportType(req.body?.report_type);
  const fileUrl = (req.body?.file_url || "").toString().trim();
  const fileName = (req.body?.file_name || "").toString().trim();
  if (!fileUrl) {
    return res.status(400).json({
      success: false,
      message: "file_url is required",
      report_type: reportType,
      fields: [],
      issues: ["file_url is required"],
      parameters: [],
    });
  }

  try {
    const startedAt = Date.now();
    const result = await extractReportWithOpenAI({ reportType, fileUrl, fileName });
    res.set("X-Reports-OCR-Duration-Ms", String(Date.now() - startedAt));
    return res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 502;
    console.error("Report extraction failed:", error);
    return res.status(statusCode).json({
      success: false,
      report_type: reportType,
      fields: [],
      lft_score: null,
      cbc_score: null,
      status: null,
      issues: [error.message || "Report extraction failed"],
      parameters: [],
      raw_text_summary: null,
    });
  }
});

module.exports = router;
