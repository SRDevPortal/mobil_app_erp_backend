const express = require("express");
const { erpCallMethod } = require("../frappeClient");
const { unwrapMobileAppV1Message } = require("../services/userService");
const {
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
 * Upserts profile row(s) via Frappe **`mobile_app.api.v1.users_full_sync`** (`profiles` child table).
 *
 * There is **no** fallback to `/api/resource/Mobile App User Profile`: on many benches profile rows
 * exist only as child items under **Mobile App User**, so that Resource route returns **404**.
 *
 * Body: `{ "external_id": "...", "profiles": [ { profile_name, phone, ... } ] }`
 * or legacy flat fields on the root object (wrapped into one profile row).
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

    let parsed;
    try {
      parsed = await erpCallMethod("mobile_app.api.v1.users_full_sync", {
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
    } catch (e) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 502;
      return res.status(status).json({
        success: false,
        message: e.message || "users_full_sync failed",
        frappePath: e.frappePath,
        detail: e.payload,
      });
    }

    const data = unwrapMobileAppV1Message(parsed);
    if (data && typeof data === "object") {
      return res.json({ success: true, data });
    }

    return res.status(502).json({
      success: false,
      message:
        "Frappe returned 200 but users_full_sync payload could not be parsed (expected message.success + message.data).",
      raw: parsed,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
