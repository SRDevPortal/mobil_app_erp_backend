const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { findMobileAppUser } = require("../services/userService");
const { mapAppointmentToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    let userLink = null;
    const user = await findMobileAppUser(body, {}, {});
    if (user?.name) userLink = user.name;

    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();

    const doc = mapAppointmentToFrappe({ ...body, external_id }, userLink);

    if (body.booking_id) {
      const rows = await erpGetList(DOCTYPE.MOBILE_APP_APPOINTMENT, {
        filters: [["booking_id", "=", String(body.booking_id).trim()]],
        fields: ["name"],
        limit: 1,
      });
      if (rows[0]?.name) {
        const updated = await erpUpdate(DOCTYPE.MOBILE_APP_APPOINTMENT, rows[0].name, doc);
        return res.json({ success: true, data: updated });
      }
    }

    const created = await erpCreate(DOCTYPE.MOBILE_APP_APPOINTMENT, doc);
    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
