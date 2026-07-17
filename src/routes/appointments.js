const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCallMethod, erpGetDoc, erpUpdate } = require("../frappeClient");
const { findMobileAppUser, tryUsersLookupV1, unwrapMobileAppV1Message } = require("../services/userService");
const { mapAppointmentChildRowForFullSync, pickExternalId, pickPhone } = require("../normalize");

const router = express.Router();

function stripRootUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function saveAppointmentsViaResourceApi(userName, next) {
  if (!userName) {
    const err = new Error("Mobile App User not found for appointment sync fallback");
    err.status = 404;
    throw err;
  }
  const saved = await erpUpdate(DOCTYPE.MOBILE_APP_USER, userName, {
    appointments: next,
  });
  return saved || { name: userName, appointments: next };
}

/**
 * Create or update one appointment row on **Mobile App User** → **`appointments`** child table
 * via Frappe **`mobile_app.api.v1.users_full_sync`** (not `/api/resource/Mobile App Appointment`,
 * which is absent when appointments live only as child rows).
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    const userRow = await findMobileAppUser(body, {}, {});
    const parentExternalId = pickExternalId(body) || (userRow?.external_id != null ? String(userRow.external_id).trim() : "");
    if (!parentExternalId) {
      return res.status(400).json({
        success: false,
        message: "external_id (or customer_id / id) or a resolvable Mobile App User is required",
      });
    }

    const rowBody = { ...body };
    const newRow = mapAppointmentChildRowForFullSync(rowBody, parentExternalId);
    if (!newRow?.appointment_external_id) {
      return res.status(400).json({ success: false, message: "appointment_external_id could not be set" });
    }

    let existing = [];
    const v1 = await tryUsersLookupV1(body);
    if (Array.isArray(v1?.appointments) && v1.appointments.length) {
      existing = v1.appointments.map((r) => ({ ...r }));
    } else if (userRow?.name) {
      try {
        const doc = await erpGetDoc(DOCTYPE.MOBILE_APP_USER, userRow.name);
        if (doc && Array.isArray(doc.appointments)) existing = doc.appointments.map((r) => ({ ...r }));
      } catch (_) {
        /* keep existing [] */
      }
    }

    const bid = body.booking_id != null ? String(body.booking_id).trim() : "";
    const extId = newRow.appointment_external_id;
    let next = existing.filter((r) => {
      const rBid = r.booking_id != null ? String(r.booking_id).trim() : "";
      const rExt = r.appointment_external_id != null ? String(r.appointment_external_id).trim() : "";
      if (bid && rBid === bid) return false;
      if (extId && rExt === extId) return false;
      return true;
    });
    next.push(newRow);

    let parsed;
    let savedViaResourceApi = false;
    try {
      parsed = await erpCallMethod("mobile_app.api.v1.users_full_sync", {
        method: "POST",
        appToken: true,
        body: stripRootUndefined({
          external_id: parentExternalId,
          supabase_user_id:
            body.supabase_user_id != null ? String(body.supabase_user_id).trim() : undefined,
          email: body.email != null ? String(body.email).trim() : undefined,
          phone: pickPhone(body) || undefined,
          appointments: next,
        }),
      });
    } catch (e) {
      try {
        parsed = {
          message: {
            success: true,
            data: await saveAppointmentsViaResourceApi(userRow?.name || parentExternalId, next),
          },
        };
        savedViaResourceApi = true;
      } catch (fallbackError) {
        const status = fallbackError.status >= 400 && fallbackError.status < 600 ? fallbackError.status : 502;
        return res.status(status).json({
          success: false,
          message: fallbackError.message || e.message || "appointment Resource API fallback failed",
          frappePath: fallbackError.frappePath || e.frappePath,
          detail: fallbackError.payload || e.payload,
        });
      }
    }

    const data = unwrapMobileAppV1Message(parsed);
    if (data && typeof data === "object") {
      return res.status(201).json({ success: true, data: { ...data, saved_via_resource_api: savedViaResourceApi } });
    }

    if (!savedViaResourceApi) {
      try {
        const saved = await saveAppointmentsViaResourceApi(userRow?.name || parentExternalId, next);
        return res.status(201).json({ success: true, data: { ...saved, saved_via_resource_api: true } });
      } catch (fallbackError) {
        const status = fallbackError.status >= 400 && fallbackError.status < 600 ? fallbackError.status : 502;
        return res.status(status).json({
          success: false,
          message:
            fallbackError.message ||
            "Frappe returned 200 but users_full_sync payload could not be parsed; appointment fallback failed.",
          frappePath: fallbackError.frappePath,
          detail: fallbackError.payload,
          raw: parsed,
        });
      }
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
