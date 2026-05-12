const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { mapDoctorToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();

router.post("/sync", async (req, res) => {
  try {
    const body = { ...req.body };
    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();
    const doc = mapDoctorToFrappe({ ...body, external_id });

    const rows = await erpGetList(DOCTYPE.MOBILE_APP_DOCTOR, {
      filters: [["external_id", "=", external_id]],
      fields: ["name"],
      limit: 1,
    });
    const saved = rows[0]?.name
      ? await erpUpdate(DOCTYPE.MOBILE_APP_DOCTOR, rows[0].name, doc)
      : await erpCreate(DOCTYPE.MOBILE_APP_DOCTOR, doc);
    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
