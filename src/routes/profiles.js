const express = require("express");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { resolveUserMiddleware } = require("../services/userService");
const { mapProfileToFrappe } = require("../normalize");

const router = express.Router();
router.use(resolveUserMiddleware);

router.post("/sync", async (req, res) => {
  try {
    const doc = mapProfileToFrappe(req.body || {}, req.userLinkName);
    const rows = await erpGetList(DOCTYPE.MOBILE_APP_USER_PROFILE, {
      filters: [["user_id", "=", req.userLinkName]],
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
