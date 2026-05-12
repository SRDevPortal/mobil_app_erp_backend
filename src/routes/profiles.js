const express = require("express");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList, erpCallMethod } = require("../frappeClient");
const { findMobileAppUser, unwrapMobileAppV1Message } = require("../services/userService");
const {
  mapProfileToFrappe,
  pickExternalId,
  pickPhone,
  buildProfilesPayloadForFullSync,
} = require("../normalize");

const router = express.Router();

function stripRootUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Upserts profile row(s) on **Mobile App User** via Frappe `mobile_app.api.v1.users_full_sync`
 * (`profiles` child table). Falls back to Resource API only if V1 is unavailable.
 *
 * Prefer body shape:
 * `{ "external_id": "...", "profiles": [ { profile_name, phone, email, ... } ] }`
 */
router.post("/sync", async (req, res) => {
  try {
    const body = req.body || {};
    const external_id = pickExternalId(body);
    if (!external_id) {
      return res.status(400).json({
        success: false,
        message: "external_id (or customer_id / id) is required",
      });
    }

    const profiles = buildProfilesPayloadForFullSync(body);

    try {
      const parsed = await erpCallMethod("mobile_app.api.v1.users_full_sync", {
        method: "POST",
        body: stripRootUndefined({
          external_id,
          supabase_user_id:
            body.supabase_user_id != null ? String(body.supabase_user_id).trim() : undefined,
          email: body.email != null ? String(body.email).trim() : undefined,
          phone: pickPhone(body) || undefined,
          profiles,
        }),
      });
      const data = unwrapMobileAppV1Message(parsed);
      if (data && typeof data === "object") {
        return res.json({ success: true, data });
      }
    } catch (e) {
      console.warn("[profiles/sync] users_full_sync failed, legacy fallback:", e.message);
    }

    const user = await findMobileAppUser(body, {}, {});
    if (!user?.name) {
      return res.status(404).json({
        success: false,
        message:
          "Mobile App User not found. Sync user first (POST /api/v1/users/sync) or fix ERP_BASE_URL / ERP_TOKEN.",
      });
    }

    const flat =
      Array.isArray(body.profiles) && body.profiles.length ? body.profiles[0] : body;
    const doc = mapProfileToFrappe(flat, user.name);
    const rows = await erpGetList(DOCTYPE.MOBILE_APP_USER_PROFILE, {
      filters: [["user_id", "=", user.name]],
      fields: ["name"],
      limit: 1,
    });
    const saved = rows[0]?.name
      ? await erpUpdate(DOCTYPE.MOBILE_APP_USER_PROFILE, rows[0].name, doc)
      : await erpCreate(DOCTYPE.MOBILE_APP_USER_PROFILE, doc);
    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
