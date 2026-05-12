const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { mapDiseaseMasterToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();

router.post("/sync", async (req, res) => {
  try {
    const body = { ...req.body };
    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();
    const doc = mapDiseaseMasterToFrappe({ ...body, external_id });

    const byId = await erpGetList(DOCTYPE.MOBILE_APP_DISEASE, {
      filters: [["external_id", "=", external_id]],
      fields: ["name"],
      limit: 1,
    });
    let saved;
    if (byId[0]?.name) {
      saved = await erpUpdate(DOCTYPE.MOBILE_APP_DISEASE, byId[0].name, doc);
    } else if (body.handle) {
      const byHandle = await erpGetList(DOCTYPE.MOBILE_APP_DISEASE, {
        filters: [["handle", "=", String(body.handle).trim()]],
        fields: ["name"],
        limit: 1,
      });
      saved = byHandle[0]?.name
        ? await erpUpdate(DOCTYPE.MOBILE_APP_DISEASE, byHandle[0].name, doc)
        : await erpCreate(DOCTYPE.MOBILE_APP_DISEASE, doc);
    } else {
      saved = await erpCreate(DOCTYPE.MOBILE_APP_DISEASE, doc);
    }

    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
