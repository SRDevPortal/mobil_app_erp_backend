const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { findMobileAppUser } = require("../services/userService");
const { upsertMobileAppUser } = require("../services/mobileAppUserSync");
const { pickSessionExternalId, mapSessionToFrappe, attachCustomerIdentity } = require("../normalize");

const router = express.Router();

router.post("/sync", async (req, res) => {
  try {
    const { saved, external_id } = await upsertMobileAppUser(req.body || {});
    const ext = saved?.external_id ?? external_id;
    return res.json({
      success: true,
      data: attachCustomerIdentity(saved || {}, ext),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.get("/lookup", async (req, res) => {
  try {
    const user = await findMobileAppUser(req.query || {}, {}, {});
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({
      success: true,
      data: attachCustomerIdentity(user, user.external_id),
    });
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
