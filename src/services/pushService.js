const {
  FCM_SERVER_KEY,
  ONESIGNAL_APP_ID,
  ONESIGNAL_REST_API_KEY,
} = require("../config");

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function stringData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}

async function sendOneSignalPush({ oneSignalUserId, title, body, data }) {
  const userId = clean(oneSignalUserId);
  if (!userId) return { sent: false, skipped: "missing_onesignal_user_id" };
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    return { sent: false, skipped: "onesignal_not_configured" };
  }

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_aliases: { onesignal_id: [userId] },
      target_channel: "push",
      headings: { en: clean(title) || "Appointment Update" },
      contents: { en: clean(body) },
      data: data || {},
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = { message: text };
  }

  if (!response.ok) {
    return {
      sent: false,
      status: response.status,
      provider: "onesignal",
      detail: payload,
    };
  }

  return { sent: true, provider: "onesignal", detail: payload };
}

async function sendFirebasePush({ fcmToken, title, body, data }) {
  const token = clean(fcmToken);
  if (!token) return { sent: false, skipped: "missing_fcm_token" };
  if (!FCM_SERVER_KEY) return { sent: false, skipped: "firebase_not_configured" };

  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${FCM_SERVER_KEY}`,
    },
    body: JSON.stringify({
      to: token,
      priority: "high",
      notification: {
        title: clean(title) || "Appointment Update",
        body: clean(body),
      },
      data: stringData(data),
    }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = { message: text };
  }

  if (!response.ok) {
    return {
      sent: false,
      status: response.status,
      provider: "firebase",
      detail: payload,
    };
  }

  return { sent: true, provider: "firebase", detail: payload };
}

async function sendAppointmentPush({
  event,
  bookingId,
  appointmentDate,
  appointmentTime,
  doctorName,
  patientName,
  title,
  body,
  oneSignalUserId,
  fcmToken,
}) {
  const data = {
    type: "appointment",
    event: clean(event),
    bookingId: clean(bookingId),
    appointmentDate: clean(appointmentDate),
    appointmentTime: clean(appointmentTime),
    doctorName: clean(doctorName),
    screen: "appointment_details",
  };
  const displayTitle = clean(title) || "Appointment Update";
  const displayBody = clean(body);

  const [oneSignal, firebase] = await Promise.all([
    sendOneSignalPush({
      oneSignalUserId,
      title: displayTitle,
      body: displayBody,
      data,
    }),
    sendFirebasePush({
      fcmToken,
      title: displayTitle,
      body: displayBody,
      data,
    }),
  ]);

  return {
    oneSignal,
    firebase,
    sent: Boolean(oneSignal.sent || firebase.sent),
    event: data.event,
  };
}

function appointmentTitleForEvent(event) {
  if (event === "booking_confirmed") return "Appointment Confirmed";
  if (event === "appointment_rescheduled") return "Appointment Rescheduled";
  if (event === "appointment_reminder") return "Appointment Reminder";
  return "Appointment Update";
}

function appointmentBodyForEvent({
  event,
  appointmentDate,
  appointmentTime,
  doctorName,
  patientName,
}) {
  const doctor = clean(doctorName) || "Doctor";
  const date = clean(appointmentDate);
  const time = clean(appointmentTime);
  if (event === "booking_confirmed") {
    return `Your appointment with ${doctor} is confirmed for ${date} at ${time}.`;
  }
  if (event === "appointment_rescheduled") {
    return `Your appointment with ${doctor} is rescheduled for ${date} at ${time}.`;
  }
  if (event === "appointment_reminder") {
    return `Reminder: your appointment with ${doctor} is at ${time}.`;
  }
  const name = clean(patientName);
  return `${name ? `${name}, your` : "Your"} appointment with ${doctor} is scheduled for ${date} at ${time}.`;
}

module.exports = {
  appointmentBodyForEvent,
  appointmentTitleForEvent,
  sendAppointmentPush,
};
