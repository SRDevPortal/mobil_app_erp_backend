const express = require("express");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("../config");
const { fetchSupabaseUser } = require("../supabaseAuth");
const { syncMobileAppUserViaV1 } = require("../services/userService");
const { attachCustomerIdentity } = require("../normalize");

const router = express.Router();

function pickPhoneFromSupabaseUser(supabaseUser, body = {}) {
  const b = body || {};
  const fromBody =
    (b.phone != null && String(b.phone).trim()) ||
    (b.mobile != null && String(b.mobile).trim()) ||
    "";
  if (fromBody) return fromBody;

  const u = supabaseUser || {};
  const meta = u.user_metadata || {};
  return (
    (u.phone != null && String(u.phone).trim()) ||
    (meta.phone != null && String(meta.phone).trim()) ||
    (meta.mobile != null && String(meta.mobile).trim()) ||
    (meta.mobile_no != null && String(meta.mobile_no).trim()) ||
    ""
  );
}

/**
 * Validates the caller's Supabase session (same idea as your n8n → GET /auth/v1/user),
 * then upserts **Mobile App User** with stable ids:
 * - `external_id` / `supabase_user_id` = Supabase user UUID (unique key for all DocTypes).
 *
 * No `APP_ERP_TOKEN` — only a valid Supabase access JWT + server-side Supabase anon key.
 */
router.post("/verify-supabase", async (req, res) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(503).json({
        success: false,
        message: "Supabase is not configured (SUPABASE_URL / SUPABASE_ANON_KEY on server)",
      });
    }

    const body = req.body || {};
    const access =
      body.supabaseAccessToken ||
      body.supabase_access_token ||
      body.access_token ||
      "";

    const supabaseUser = await fetchSupabaseUser(access);
    if (!supabaseUser || !supabaseUser.id) {
      return res.status(401).json({ success: false, message: "Invalid or expired Supabase session" });
    }

    const email = supabaseUser.email != null ? String(supabaseUser.email).trim() : "";
    const phone = pickPhoneFromSupabaseUser(supabaseUser, body);

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: "Supabase user has no email or phone; pass phone in JSON body if using phone-only flows",
      });
    }

    const meta = supabaseUser.user_metadata || {};
    const fullName =
      [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim() ||
      meta.full_name ||
      meta.name ||
      email ||
      phone ||
      supabaseUser.id;

    const payload = {
      external_id: supabaseUser.id,
      supabase_user_id: supabaseUser.id,
      email: email || undefined,
      phone: phone || undefined,
      full_name: fullName,
      first_name: meta.first_name,
      last_name: meta.last_name,
      avatar_url: meta.avatar_url,
      profile_image_url: meta.profile_image_url,
      is_active: true,
      last_login_at: new Date().toISOString(),
    };

    // Mobile App User has a controller-level permission check that blocks
    // Resource API creation even when role permissions include Create. The
    // app-token-protected Frappe method is the authoritative onboarding path.
    const saved = await syncMobileAppUserViaV1(payload, { throwOnError: true });
    const external_id = saved.external_id || supabaseUser.id;

    const erpFullName =
      (saved?.full_name != null && String(saved.full_name).trim() !== ""
        ? String(saved.full_name).trim()
        : null) || fullName;

    return res.json({
      success: true,
      data: attachCustomerIdentity(
        {
          supabase_user_id: supabaseUser.id,
          mobile_app_user_name: saved?.name ?? null,
          email: email || null,
          phone: phone || null,
          full_name: erpFullName,
        },
        external_id,
      ),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
