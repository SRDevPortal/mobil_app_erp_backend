const { APP_ERP_TOKEN } = require("../config");

function normalizeIncomingToken(s) {
  return (s || "").toString().replace(/^\uFEFF/, "").trim();
}

function requireAppToken(req, res, next) {
  if (!APP_ERP_TOKEN) {
    return res.status(503).json({
      success: false,
      message: "APP_ERP_TOKEN is not configured on server",
    });
  }

  const fromHeader = normalizeIncomingToken(req.get("x-erp-token"));
  const bearer = normalizeIncomingToken(req.get("authorization"));
  const fromBearer = bearer.toLowerCase().startsWith("bearer ") ? normalizeIncomingToken(bearer.slice(7)) : "";
  const incoming = fromHeader || fromBearer;

  if (!incoming || incoming !== APP_ERP_TOKEN) {
    return res.status(401).json({ success: false, message: "Invalid ERP token" });
  }
  return next();
}

module.exports = { requireAppToken };
