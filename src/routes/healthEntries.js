const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate } = require("../frappeClient");
const { resolveUserMiddleware } = require("../services/userService");
const { mapHealthEntryToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();
router.use(resolveUserMiddleware);

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.tool_key) {
      return res.status(400).json({ success: false, message: "tool_key is required" });
    }
    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();
    const doc = mapHealthEntryToFrappe({ ...body, external_id }, req.userLinkName);
    const saved = await erpCreate(DOCTYPE.MOBILE_APP_HEALTH_ENTRY, doc);
    return res.status(201).json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
