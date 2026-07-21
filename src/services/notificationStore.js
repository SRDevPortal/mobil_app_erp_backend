const fs = require("fs/promises");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const appointmentsPath = path.join(dataDir, "appointments.json");
const notificationsPath = path.join(dataDir, "notifications.json");

function clean(value) {
  return value == null ? "" : String(value).trim();
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function writeJsonArray(filePath, items) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(items.slice(0, 500), null, 2));
}

async function readAppointments() {
  return readJsonArray(appointmentsPath);
}

async function upsertAppointment(input) {
  const bookingId = clean(input.bookingId || input.booking_id) || `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const items = await readAppointments();
  const existingIndex = items.findIndex((item) => clean(item.bookingId) === bookingId);
  const previous = existingIndex >= 0 ? items[existingIndex] : {};
  const next = {
    ...previous,
    bookingId,
    patientName: clean(input.patientName || input.patient_name || previous.patientName),
    patientEmail: clean(input.patientEmail || input.patient_email || input.email || previous.patientEmail),
    patientPhone: clean(input.patientPhone || input.patient_phone || input.phone || previous.patientPhone),
    doctorName: clean(input.doctorName || input.doctor_name || previous.doctorName),
    appointmentDate: clean(input.appointmentDate || input.appointment_date || previous.appointmentDate),
    appointmentTime: clean(input.appointmentTime || input.appointment_time || previous.appointmentTime),
    appointmentType: clean(input.appointmentType || input.appointment_type || previous.appointmentType),
    appointmentFor: clean(input.appointmentFor || input.appointment_for || previous.appointmentFor),
    pageUrl: clean(input.pageUrl || input.page_url || previous.pageUrl),
    diseaseName: clean(input.diseaseName || input.disease_name || previous.diseaseName),
    paymentProvider: clean(input.paymentProvider || input.payment_provider || previous.paymentProvider),
    paymentStatus: clean(input.paymentStatus || input.payment_status || previous.paymentStatus),
    razorpayOrderId: clean(input.razorpayOrderId || input.razorpay_order_id || previous.razorpayOrderId),
    razorpayPaymentId: clean(input.razorpayPaymentId || input.razorpay_payment_id || previous.razorpayPaymentId),
    paidAmount: clean(input.paidAmount || input.paid_amount || previous.paidAmount),
    payableAtClinic: clean(input.payableAtClinic || input.payable_at_clinic || previous.payableAtClinic),
    oneSignalUserId: clean(input.oneSignalUserId || input.onesignal_user_id || input.player_id || previous.oneSignalUserId),
    oneSignalPushToken: clean(input.oneSignalPushToken || input.one_signal_push_token || previous.oneSignalPushToken),
    fcmToken: clean(input.fcmToken || input.fcm_token || previous.fcmToken),
    status: clean(input.status || previous.status || "Confirmed"),
    updatedAt: new Date().toISOString(),
    createdAt: previous.createdAt || new Date().toISOString(),
    reminderSentAt: input.resetReminder === true ? "" : clean(previous.reminderSentAt),
  };
  if (existingIndex >= 0) items[existingIndex] = next;
  else items.push(next);
  await writeJsonArray(appointmentsPath, items);
  return next;
}

async function markReminderSent(bookingId) {
  const id = clean(bookingId);
  const items = await readAppointments();
  const idx = items.findIndex((item) => clean(item.bookingId) === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], reminderSentAt: new Date().toISOString(), lastPushEvent: "appointment_reminder" };
  await writeJsonArray(appointmentsPath, items);
  return items[idx];
}

async function readNotifications() {
  return readJsonArray(notificationsPath);
}

async function saveNotification({ appointment, event, title, body, data, push }) {
  const items = await readNotifications();
  const bookingId = clean(data.bookingId || appointment.bookingId);
  const ticketId = clean(data.ticketId || data.ticket_id || appointment.ticketId || appointment.id);
  const ticketNumber = clean(data.ticketNumber || data.ticket_number || appointment.ticketNumber);
  const appointmentTime = clean(data.appointmentTime);
  const type = clean(data.type) || (ticketId || ticketNumber ? "support_ticket" : "appointment");
  const id = ticketId || ticketNumber
    ? `support-ticket-${ticketId || ticketNumber}-${event}-${clean(data.messageId || data.message_id || data.status).replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`
    : bookingId
      ? `appointment-${bookingId}-${event}-${appointmentTime.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`
      : `${type}-${event}-${Date.now()}`;
  const item = {
    id,
    title: clean(title) || "Notification",
    body: clean(body),
    type,
    event: clean(event),
    bookingId,
    ticketId,
    ticketNumber,
    subject: clean(data.subject),
    status: clean(data.status),
    messageId: clean(data.messageId || data.message_id),
    appointmentDate: clean(data.appointmentDate),
    appointmentTime,
    doctorName: clean(data.doctorName),
    patientName: clean(data.patientName),
    patientEmail: clean(data.patientEmail),
    patientPhone: clean(data.patientPhone),
    appointmentType: clean(data.appointmentType),
    appointmentFor: clean(data.appointmentFor),
    pageUrl: clean(data.pageUrl),
    diseaseName: clean(data.diseaseName),
    paymentProvider: clean(data.paymentProvider || data.payment_provider),
    paymentStatus: clean(data.paymentStatus || data.payment_status),
    razorpayOrderId: clean(data.razorpayOrderId || data.razorpay_order_id),
    razorpayPaymentId: clean(data.razorpayPaymentId || data.razorpay_payment_id),
    paidAmount: clean(data.paidAmount || data.paid_amount),
    payableAtClinic: clean(data.payableAtClinic || data.payable_at_clinic),
    oneSignalUserId: clean(appointment.oneSignalUserId || appointment.onesignal_user_id || appointment.player_id),
    oneSignalPushToken: clean(appointment.oneSignalPushToken || appointment.one_signal_push_token),
    fcmToken: clean(appointment.fcmToken || appointment.fcm_token),
    data: data || {},
    push: push || null,
    sentAt: new Date().toISOString(),
  };
  items.unshift(item);
  await writeJsonArray(notificationsPath, items);
  return item;
}

async function listNotificationsForTarget(query = {}) {
  const oneSignalUserId = clean(query.oneSignalUserId || query.onesignal_user_id || query.player_id);
  const oneSignalPushToken = clean(query.oneSignalPushToken || query.one_signal_push_token);
  const fcmToken = clean(query.fcmToken || query.fcm_token);
  const limit = Math.min(Number(query.limit) || 50, 100);
  const items = await readNotifications();
  return items
    .filter((item) => {
      if (oneSignalUserId && item.oneSignalUserId === oneSignalUserId) return true;
      if (oneSignalPushToken && item.oneSignalPushToken === oneSignalPushToken) return true;
      if (fcmToken && item.fcmToken === fcmToken) return true;
      return false;
    })
    .slice(0, limit);
}

module.exports = {
  listNotificationsForTarget,
  markReminderSent,
  readAppointments,
  saveNotification,
  upsertAppointment,
};
