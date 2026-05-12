require("dotenv").config();

const trim = (v) => (v || "").toString().trim();

/** Strip BOM / whitespace (Windows .env UTF-8 BOM breaks strict token match). */
function normalizeSecret(v) {
  return trim(v).replace(/^\uFEFF/, "");
}

const ERP_BASE_URL = trim(process.env.ERP_BASE_URL || "").replace(/\/+$/, "");
const ERP_TOKEN = normalizeSecret(process.env.ERP_TOKEN || "");
/** Same value as Frappe `site_config.json` → `mobile_app_erp_token`. If set, used for `mobile_app.api.v1.*` only. */
const MOBILE_APP_ERP_TOKEN = normalizeSecret(process.env.MOBILE_APP_ERP_TOKEN || "");
const ERP_AUTH_SCHEME = trim(process.env.ERP_AUTH_SCHEME || "token").toLowerCase();
const APP_ERP_TOKEN = normalizeSecret(process.env.APP_ERP_TOKEN || "");
const PORT = Number(process.env.PORT || 3101);

/** Supabase project (for POST /api/auth/verify-supabase — validates user JWT like n8n). */
const SUPABASE_URL = trim(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = normalizeSecret(process.env.SUPABASE_ANON_KEY || "");

const DOCTYPE = {
  MOBILE_APP_USER: trim(process.env.DOCTYPE_MOBILE_APP_USER || "Mobile App User"),
  MOBILE_APP_USER_SESSION: trim(process.env.DOCTYPE_MOBILE_APP_USER_SESSION || "Mobile App User Session"),
  MOBILE_APP_USER_PROFILE: trim(process.env.DOCTYPE_MOBILE_APP_USER_PROFILE || "Mobile App User Profile"),
  MOBILE_APP_DISEASE: trim(process.env.DOCTYPE_MOBILE_APP_DISEASE || "Mobile App Disease"),
  MOBILE_APP_USER_DISEASE_SELECTION:
    trim(process.env.DOCTYPE_MOBILE_APP_USER_DISEASE_SELECTION || "Mobile App User Disease Selection"),
  MOBILE_APP_HEALTH_ENTRY: trim(process.env.DOCTYPE_MOBILE_APP_HEALTH_ENTRY || "Mobile App Health Entry"),
  MOBILE_APP_PRESCRIPTION: trim(process.env.DOCTYPE_MOBILE_APP_PRESCRIPTION || "Mobile App Prescription"),
  MOBILE_APP_DOCTOR: trim(process.env.DOCTYPE_MOBILE_APP_DOCTOR || "Mobile App Doctor"),
  MOBILE_APP_APPOINTMENT: trim(process.env.DOCTYPE_MOBILE_APP_APPOINTMENT || "Mobile App Appointment"),
  MOBILE_APP_NOTIFICATION: trim(process.env.DOCTYPE_MOBILE_APP_NOTIFICATION || "Mobile App Notification"),
  MOBILE_APP_SUPPORT_TICKET: trim(process.env.DOCTYPE_MOBILE_APP_SUPPORT_TICKET || "Mobile App Support Ticket"),
  MOBILE_APP_WEBHOOK_EVENT: trim(process.env.DOCTYPE_MOBILE_APP_WEBHOOK_EVENT || "Mobile App Webhook Event"),
};

/**
 * Frappe Resource API often uses `Authorization: token api_key:secret`.
 * **`mobile_app.api.v1.*`** (users_lookup, users_full_sync, …) expects the same secret as
 * **`site_config.json` → `mobile_app_erp_token`** via **`X-ERP-Token`** or **`Bearer`** — see api-list-erp.md.
 * We always send **X-ERP-Token** when `ERP_TOKEN` is set so V1 methods authenticate reliably.
 */
function erpAuthHeader() {
  if (!ERP_TOKEN) return {};
  const headers = { "X-ERP-Token": ERP_TOKEN };
  if (ERP_AUTH_SCHEME === "bearer") {
    headers.Authorization = `Bearer ${ERP_TOKEN}`;
  } else {
    headers.Authorization = `token ${ERP_TOKEN}`;
  }
  return headers;
}

/**
 * Auth for Frappe `mobile_app.api.v1.*` — `require_app_token()` checks **`mobile_app_erp_token`**.
 * Use **only** `X-ERP-Token` + **`Authorization: Bearer`** (do not send `Authorization: token api_key:secret`
 * here — that breaks validation when `ERP_TOKEN` is a Desk API key).
 */
function erpAuthHeaderMobileV1() {
  const token = (MOBILE_APP_ERP_TOKEN || ERP_TOKEN || "").trim();
  if (!token) return {};
  return {
    "X-ERP-Token": token,
    Authorization: `Bearer ${token}`,
  };
}

function mobileAppV1TokenConfigured() {
  return Boolean(MOBILE_APP_ERP_TOKEN || ERP_TOKEN);
}

module.exports = {
  ERP_BASE_URL,
  ERP_TOKEN,
  MOBILE_APP_ERP_TOKEN,
  ERP_AUTH_SCHEME,
  APP_ERP_TOKEN,
  PORT,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  DOCTYPE,
  erpAuthHeader,
  erpAuthHeaderMobileV1,
  mobileAppV1TokenConfigured,
};
