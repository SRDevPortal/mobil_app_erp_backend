const express = require("express");
const { DOCTYPE } = require("../config");
const { erpGetDoc, erpGetList } = require("../frappeClient");
const {
  appointmentBodyForEvent,
  appointmentTitleForEvent,
  sendAppointmentPush,
} = require("../services/pushService");

const router = express.Router();

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function readPayloadJson(row = {}) {
  const raw = row.payload_json;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function parseDateTime(dateValue, timeValue) {
  const date = clean(dateValue);
  const time = clean(timeValue);
  if (!date || !time) return null;

  const dateMatch =
    date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ||
    date.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!dateMatch) return null;

  let year;
  let month;
  let day;
  if (dateMatch[1].length === 4) {
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    day = Number(dateMatch[3]);
  } else {
    day = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    year = Number(dateMatch[3]);
  }

  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const ampm = clean(timeMatch[3]).toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

router.post("/send", async (req, res) => {
  try {
    const body = req.body || {};
    const event = clean(body.event) || "appointment_update";
    const payload = {
      event,
      bookingId: body.booking_id || body.bookingId,
      appointmentDate: body.appointment_date || body.appointmentDate,
      appointmentTime: body.appointment_time || body.appointmentTime,
      doctorName: body.doctor_name || body.doctorName,
      patientName: body.patient_name || body.patientName,
      oneSignalUserId: body.onesignal_user_id || body.oneSignalUserId || body.player_id,
      fcmToken: body.fcm_token || body.fcmToken,
    };

    const result = await sendAppointmentPush({
      ...payload,
      title: body.title || appointmentTitleForEvent(event),
      body: body.body || appointmentBodyForEvent(payload),
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/reminders/run", async (req, res) => {
  try {
    const body = req.body || {};
    const reminderBeforeMinutes = Number(body.reminderBeforeMinutes || 120);
    const lookaheadMinutes = Number(body.lookaheadMinutes || 15);
    const limit = Number(body.limit || 500);
    const now = body.now ? new Date(body.now) : new Date();
    const dueStart = new Date(now.getTime() + reminderBeforeMinutes * 60 * 1000);
    const dueEnd = new Date(dueStart.getTime() + lookaheadMinutes * 60 * 1000);

    const users = await erpGetList(DOCTYPE.MOBILE_APP_USER, {
      fields: ["name"],
      limit,
      orderBy: "modified desc",
    });

    let checked = 0;
    let sent = 0;
    const results = [];
    for (const user of users) {
      if (!user?.name) continue;
      const doc = await erpGetDoc(DOCTYPE.MOBILE_APP_USER, user.name);
      const appointments = Array.isArray(doc?.appointments) ? doc.appointments : [];
      for (const row of appointments) {
        checked += 1;
        const status = clean(row.status).toLowerCase();
        if (status === "cancelled" || status === "canceled" || status === "completed") {
          continue;
        }

        const scheduledAt = parseDateTime(row.appointment_date, row.appointment_time);
        if (!scheduledAt || scheduledAt < dueStart || scheduledAt > dueEnd) continue;

        const payloadJson = readPayloadJson(row);
        const oneSignalUserId = clean(
          row.onesignal_user_id || payloadJson.oneSignalUserId || payloadJson.onesignal_user_id,
        );
        const fcmToken = clean(row.fcm_token || payloadJson.fcmToken || payloadJson.fcm_token);
        if (!oneSignalUserId && !fcmToken) continue;

        const payload = {
          event: "appointment_reminder",
          bookingId: row.booking_id,
          appointmentDate: row.appointment_date,
          appointmentTime: row.appointment_time,
          doctorName: row.doctor_name,
          oneSignalUserId,
          fcmToken,
        };
        const result = await sendAppointmentPush({
          ...payload,
          title: appointmentTitleForEvent(payload.event),
          body: appointmentBodyForEvent(payload),
        });
        if (result.sent) sent += 1;
        results.push({ bookingId: clean(row.booking_id), result });
      }
    }

    return res.json({
      success: true,
      data: {
        checked,
        sent,
        dueStart: dueStart.toISOString(),
        dueEnd: dueEnd.toISOString(),
        results,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
