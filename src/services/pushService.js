const {
  FCM_SERVER_KEY,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_PROJECT_ID,
  FIREBASE_SERVICE_ACCOUNT_JSON,
  ONESIGNAL_APP_ID,
  ONESIGNAL_REST_API_KEY,
} = require("../config");

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const PUSH_PROVIDER_TIMEOUT_MS = 15000;

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

async function fetchWithTimeout(url, options = {}, timeoutMs = PUSH_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return { message: text };
  }
}

async function sendOneSignalPush({ oneSignalUserId, oneSignalPushToken, title, body, data }) {
  const userId = clean(oneSignalUserId);
  const subscriptionId = clean(oneSignalPushToken);
  if (!userId && !subscriptionId) return { sent: false, skipped: "missing_onesignal_target" };
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) return { sent: false, skipped: "onesignal_not_configured" };

  const targets = [];
  if (subscriptionId) targets.push({ name: "subscription_id", payload: { include_subscription_ids: [subscriptionId] } });
  if (userId) targets.push({ name: "onesignal_id", payload: { include_aliases: { onesignal_id: [userId] }, target_channel: "push" } });

  const attempts = [];
  for (const target of targets) {
    const response = await fetchWithTimeout("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${ONESIGNAL_REST_API_KEY}` },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        ...target.payload,
        headings: { en: clean(title) || "Appointment Update" },
        contents: { en: clean(body) },
        priority: 10,
        android_visibility: 1,
        android_sound: "default",
        ios_sound: "default",
        data: data || {},
      }),
    });
    const detail = await parseResponse(response);
    const result = response.ok
      ? { sent: true, provider: "onesignal", target: target.name, detail }
      : { sent: false, provider: "onesignal", target: target.name, status: response.status, detail };
    attempts.push(result);
    if (result.sent && result.detail?.recipients !== 0) return attempts.length === 1 ? result : { ...result, attempts };
  }
  return attempts.length ? { ...attempts[attempts.length - 1], attempts } : { sent: false, skipped: "missing_onesignal_target" };
}

function parseFirebaseConfig() {
  let credentials = null;
  if (FIREBASE_SERVICE_ACCOUNT_JSON) credentials = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  else if (FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    credentials = {
      client_email: FIREBASE_CLIENT_EMAIL,
      private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      project_id: FIREBASE_PROJECT_ID,
    };
  }
  const projectId = clean(FIREBASE_PROJECT_ID || credentials?.project_id);
  if (!credentials?.client_email || !credentials?.private_key || !projectId) return null;
  return { credentials, projectId };
}

async function getFirebaseAccessToken(credentials) {
  let GoogleAuth;
  try {
    ({ GoogleAuth } = require("google-auth-library"));
  } catch (_) {
    throw new Error("google-auth-library is not installed. Run npm install in backend-erp.");
  }
  const auth = new GoogleAuth({ credentials, scopes: [FCM_SCOPE] });
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  const token = typeof accessToken === "string" ? accessToken : accessToken?.token;
  if (!token) throw new Error("Unable to create Firebase access token");
  return token;
}

async function sendFirebasePush({ fcmToken, title, body, data }) {
  const token = clean(fcmToken);
  if (!token) return { sent: false, skipped: "missing_fcm_token" };
  try {
    const firebaseConfig = parseFirebaseConfig();
    if (!firebaseConfig) {
      return {
        sent: false,
        skipped: "firebase_v1_not_configured",
        note: FCM_SERVER_KEY ? "FCM_SERVER_KEY is legacy and is not used by this service." : undefined,
      };
    }
    const accessToken = await getFirebaseAccessToken(firebaseConfig.credentials);
    const response = await fetchWithTimeout(`https://fcm.googleapis.com/v1/projects/${firebaseConfig.projectId}/messages:send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: clean(title) || "Appointment Update", body: clean(body) },
          data: stringData(data),
          android: { priority: "HIGH", notification: { channel_id: "appointments_channel", notification_priority: "PRIORITY_HIGH", sound: "default", visibility: "PUBLIC" } },
          apns: { payload: { aps: { sound: "default" } } },
        },
      }),
    });
    const detail = await parseResponse(response);
    if (!response.ok) return { sent: false, provider: "firebase", status: response.status, detail };
    return { sent: true, provider: "firebase", detail };
  } catch (error) {
    return { sent: false, provider: "firebase", status: "config_error", detail: { message: error.message } };
  }
}

function titleForEvent(event) {
  if (event === "booking_confirmed") return "Appointment Confirmed";
  if (event === "appointment_rescheduled") return "Appointment Rescheduled";
  if (event === "appointment_reminder") return "Appointment Reminder";
  if (event === "support_ticket_agent_reply") return "Support Ticket Reply";
  if (event === "support_ticket_status_update") return "Support Ticket Updated";
  if (event === "support_ticket_updated") return "Support Ticket Updated";
  return "Appointment Update";
}

function bodyForEvent({ event, appointmentDate, appointmentTime, doctorName }) {
  const doctor = clean(doctorName) || "Doctor";
  const date = clean(appointmentDate);
  const time = clean(appointmentTime);
  if (event === "booking_confirmed") return `Your appointment with ${doctor} is confirmed for ${date} at ${time}.`;
  if (event === "appointment_rescheduled") return `Your appointment with ${doctor} is rescheduled for ${date} at ${time}.`;
  if (event === "appointment_reminder") return `Reminder: your appointment with ${doctor} is at ${time}.`;
  return `Your appointment with ${doctor} is scheduled for ${date} at ${time}.`;
}

function supportTicketBodyForEvent({ event, ticketNumber, subject, status, message }) {
  const ticket = clean(ticketNumber) || "your ticket";
  const topic = clean(subject);
  const statusText = clean(status);
  const text = clean(message);
  if (event === "support_ticket_agent_reply") {
    return text
      ? `Agent replied on ${ticket}: ${text}`.slice(0, 220)
      : `Agent replied on ${topic || ticket}.`;
  }
  if (event === "support_ticket_status_update") {
    return statusText
      ? `${ticket} status changed to ${statusText}.`
      : `${ticket} has a new update.`;
  }
  return `${ticket} has a new support update.`;
}

function buildAppointmentPush(input) {
  const event = clean(input.event) || "appointment_update";
  const data = {
    type: "appointment",
    event,
    bookingId: clean(input.bookingId || input.booking_id),
    appointmentDate: clean(input.appointmentDate || input.appointment_date),
    appointmentTime: clean(input.appointmentTime || input.appointment_time),
    doctorName: clean(input.doctorName || input.doctor_name),
    patientName: clean(input.patientName || input.patient_name),
    patientEmail: clean(input.patientEmail || input.patient_email || input.email),
    patientPhone: clean(input.patientPhone || input.patient_phone || input.phone),
    appointmentType: clean(input.appointmentType || input.appointment_type),
    appointmentFor: clean(input.appointmentFor || input.appointment_for),
    pageUrl: clean(input.pageUrl || input.page_url),
    diseaseName: clean(input.diseaseName || input.disease_name),
    screen: "appointment_details",
  };
  const title = clean(input.title) || titleForEvent(event);
  const body = clean(input.body) || bodyForEvent({ ...data, event });
  return { event, data, title, body };
}

async function sendAppointmentPush(input) {
  const { event, data, title, body } = buildAppointmentPush(input);
  const [oneSignal, firebase] = await Promise.all([
    sendOneSignalPush({
      oneSignalUserId: input.oneSignalUserId || input.onesignal_user_id || input.player_id,
      oneSignalPushToken: input.oneSignalPushToken || input.one_signal_push_token,
      title,
      body,
      data,
    }),
    sendFirebasePush({ fcmToken: input.fcmToken || input.fcm_token, title, body, data }),
  ]);
  return { event, firebase, oneSignal, sent: Boolean(oneSignal.sent || firebase.sent) };
}

function buildSupportTicketPush(input) {
  const event = clean(input.event) || "support_ticket_updated";
  const data = {
    type: "support_ticket",
    event,
    ticketId: clean(input.ticketId || input.ticket_id || input.id),
    ticketNumber: clean(input.ticketNumber || input.ticket_number),
    subject: clean(input.subject || input.title),
    status: clean(input.status),
    messageId: clean(input.messageId || input.message_id),
    message: clean(input.message),
    screen: "support_ticket_details",
  };
  const title = clean(input.title) || titleForEvent(event);
  const body = clean(input.body) || supportTicketBodyForEvent({ ...data, event });
  return { event, data, title, body };
}

async function sendSupportTicketPush(input) {
  const { event, data, title, body } = buildSupportTicketPush(input);
  const [oneSignal, firebase] = await Promise.all([
    sendOneSignalPush({
      oneSignalUserId: input.oneSignalUserId || input.onesignal_user_id || input.player_id,
      oneSignalPushToken: input.oneSignalPushToken || input.one_signal_push_token,
      title,
      body,
      data,
    }),
    sendFirebasePush({ fcmToken: input.fcmToken || input.fcm_token, title, body, data }),
  ]);
  return { event, firebase, oneSignal, sent: Boolean(oneSignal.sent || firebase.sent) };
}

module.exports = {
  buildAppointmentPush,
  buildSupportTicketPush,
  sendAppointmentPush,
  sendSupportTicketPush,
};
