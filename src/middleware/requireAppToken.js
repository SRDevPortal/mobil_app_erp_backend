const { APP_ERP_TOKEN } = require("../config");
const { fetchSupabaseUser } = require("../supabaseAuth");

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

const IDENTITY_KEYS = [
  "external_id",
  "externalId",
  "customer_id",
  "customerId",
  "supabase_user_id",
  "supabaseUserId",
  "user_id",
  "userId",
];

function bindAuthenticatedIdentity(req, user) {
  const uid = String(user.id);
  for (const source of [req.query, req.body]) {
    if (!source || typeof source !== "object") continue;
    for (const key of IDENTITY_KEYS) {
      const supplied = source[key];
      if (supplied != null && String(supplied).trim() && String(supplied).trim() !== uid) {
        const error = new Error("Requested user does not match the authenticated user");
        error.status = 403;
        throw error;
      }
    }
    source.external_id = uid;
    source.supabase_user_id = uid;
    source.customer_id = uid;
    source.user_id = uid;
    source.userId = uid;
  }
  req.authUser = user;
}

/**
 * Mobile callers authenticate with their Supabase access token. The legacy app
 * token remains available for trusted server-to-server and Postman operations,
 * but is no longer required in a distributed mobile build.
 */
async function requireUserOrAppToken(req, res, next) {
  try {
    const authorization = normalizeIncomingToken(req.get("authorization"));
    if (authorization.toLowerCase().startsWith("bearer ")) {
      const user = await fetchSupabaseUser(authorization.slice(7));
      if (!user?.id) {
        return res.status(401).json({ success: false, message: "Invalid or expired user session" });
      }
      bindAuthenticatedIdentity(req, user);
      return next();
    }

    return requireAppToken(req, res, next);
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
}

module.exports = { bindAuthenticatedIdentity, requireAppToken, requireUserOrAppToken };
