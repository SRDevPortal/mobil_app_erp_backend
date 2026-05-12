const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate } = require("../frappeClient");
const { resolveUserMiddleware } = require("../services/userService");
const { mapNotificationToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();
router.use(resolveUserMiddleware);

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();
    const doc = mapNotificationToFrappe({ ...body, external_id }, req.userLinkName);
    const saved = await erpCreate(DOCTYPE.MOBILE_APP_NOTIFICATION, doc);
    return res.status(201).json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
