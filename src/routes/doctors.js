const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList, erpGetDoc, erpCallMethod } = require("../frappeClient");
const { ERP_BASE_URL, erpAuthHeader } = require("../config");
const { mapDoctorToFrappe, pickExternalId } = require("../normalize");
const { doctorPhotoSource } = require("../services/doctorPhotoSource");
const { mergeDoctorDirectoryMetrics } = require("../services/doctorDirectoryMetrics");
const { createDoctorPhotoCache } = require("../services/doctorPhotoCache");
const photoCache = createDoctorPhotoCache();

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const [result, directory] = await Promise.all([
      erpCallMethod("mobile_app.api.practitioners.list_doctors"),
      erpCallMethod("mobile_app.api.doctor_directory.list_doctors"),
    ]);
    const data = result.message;
    if (!Array.isArray(directory.message?.doctors)) throw new Error("Invalid app doctor directory");
    data.doctors = mergeDoctorDirectoryMetrics(data.doctors, directory.message.doctors).map((doctor) => ({
      ...doctor,
      image_url: doctor.image_url ? `/api/v1/doctors/${encodeURIComponent(doctor.id)}/photo` : "",
    }));
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.status || 502).json({ success: false, message: "Unable to load practitioners from CRM" });
  }
});

router.get("/:id/availability", async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "")) {
    return res.status(400).json({ success: false, message: "A date in YYYY-MM-DD format is required" });
  }
  try {
    // Only an appointment belonging to this caller may be excluded when rescheduling.
    const exclude = String(req.query.booking_id || "").trim();
    if (exclude) {
      const { findMobileAppUser } = require("../services/userService");
      const user = await findMobileAppUser(req.query, {}, {});
      const rows = await erpGetList(DOCTYPE.MOBILE_APP_APPOINTMENT, {
        filters: [["booking_id", "=", exclude], ["mobile_app_user", "=", user?.name || ""]],
        fields: ["name"], limit: 1,
      });
      if (!rows.length) return res.status(403).json({ success: false, message: "Appointment access denied" });
    }
    const result = await erpCallMethod("mobile_app.api.practitioners.availability", {
      query: { practitioner_id: req.params.id, date: req.query.date, exclude_booking_id: exclude },
    });
    return res.json({ success: true, data: result.message });
  } catch (e) {
    return res.status(e.status || 502).json({ success: false, message: "Unable to load this doctor's schedule" });
  }
});

router.get("/:id/photo", async (req, res) => {
  try {
    const photo = await photoCache.get(req.params.id, async () => {
      const doctor = await erpGetDoc("Healthcare Practitioner", req.params.id);
      if (!doctor?.image) throw Object.assign(new Error("Photo missing"), { status: 404 });
      const source = doctorPhotoSource(doctor.image, ERP_BASE_URL, erpAuthHeader());
      if (!source) throw Object.assign(new Error("Photo missing"), { status: 404 });
      const image = await fetch(source.url, { headers: source.headers, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!image.ok) throw Object.assign(new Error("Photo unavailable"), { status: image.status });
      const type = image.headers.get("content-type") || "";
      if (!/^image\/(png|jpeg|webp|gif)(;|$)/i.test(type)) throw Object.assign(new Error("Invalid photo"), { status: 415 });
      return { type, body: Buffer.from(await image.arrayBuffer()) };
    });
    res.set("Content-Type", photo.type);
    res.set("Cache-Control", "private, no-store");
    return res.send(photo.body);
  } catch (error) { return res.sendStatus(error.status || 502); }
});

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
