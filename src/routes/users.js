const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { findMobileAppUser } = require("../services/userService");
const { mapUserToFrappe, pickExternalId, pickSessionExternalId, mapSessionToFrappe } = require("../normalize");

const router = express.Router();

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

router.post("/sync", async (req, res) => {
  try {
    const body = req.body || {};
    let external_id = pickExternalId(body);
    if (!external_id) {
      external_id = crypto.randomUUID();
    }

    const merged = { ...body, external_id };
    let existing =
      (await findMobileAppUser({ external_id }, {}, {})) ||
      (body.supabase_user_id ? await findMobileAppUser({ supabase_user_id: body.supabase_user_id }, {}, {}) : null) ||
      (body.email ? await findMobileAppUser({ email: body.email }, {}, {}) : null);

    const doc = mapUserToFrappe(merged);
    if (!doc.external_id) doc.external_id = external_id;
    if (!doc.full_name && doc.external_id) doc.full_name = doc.external_id;

    let saved;
    if (existing?.name) {
      saved = await erpUpdate(DOCTYPE.MOBILE_APP_USER, existing.name, doc);
    } else {
      saved = await erpCreate(DOCTYPE.MOBILE_APP_USER, doc);
    }

    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.get("/lookup", async (req, res) => {
  try {
    const user = await findMobileAppUser(req.query || {}, {}, {});
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({ success: true, data: user });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/sessions/sync", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await findMobileAppUser(body, {}, {});
    if (!user?.name) return res.status(404).json({ success: false, message: "Mobile App User not found for session" });

    let sessionExternal = pickSessionExternalId(body);
    if (!sessionExternal) sessionExternal = crypto.randomUUID();

    const doc = mapSessionToFrappe({ ...body, external_id: sessionExternal }, user.name);

    const rows = await erpGetList(DOCTYPE.MOBILE_APP_USER_SESSION, {
      filters: [["external_id", "=", sessionExternal]],
      fields: ["name"],
      limit: 1,
    });
    const saved = rows[0]?.name
      ? await erpUpdate(DOCTYPE.MOBILE_APP_USER_SESSION, rows[0].name, doc)
      : await erpCreate(DOCTYPE.MOBILE_APP_USER_SESSION, doc);

    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
