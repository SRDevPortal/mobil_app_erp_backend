const {
  APPOINTMENT_TIMEZONE_OFFSET_MINUTES,
  REMINDER_BEFORE_MINUTES,
  REMINDER_LOOKAHEAD_MINUTES,
} = require("../config");
const { markReminderSent, readAppointments, saveNotification } = require("./notificationStore");
const { buildAppointmentPush, sendAppointmentPush } = require("./pushService");

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function parseAppointmentDateTime(dateValue, timeValue) {
  const date = clean(dateValue);
  const time = clean(timeValue);
  if (!date || !time) return null;
  const dateMatch = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) || date.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
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
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - APPOINTMENT_TIMEZONE_OFFSET_MINUTES * 60 * 1000);
}

async function runAppointmentReminders(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const beforeMinutes = Number(options.reminderBeforeMinutes || REMINDER_BEFORE_MINUTES);
  const lookaheadMinutes = Number(options.lookaheadMinutes || REMINDER_LOOKAHEAD_MINUTES);
  const dueStart = new Date(now.getTime() + beforeMinutes * 60 * 1000);
  const dueEnd = new Date(dueStart.getTime() + lookaheadMinutes * 60 * 1000);
  const appointments = await readAppointments();
  const results = [];
  let checked = 0;
  let sent = 0;
  for (const appointment of appointments) {
    checked += 1;
    const status = clean(appointment.status).toLowerCase();
    if (status === "cancelled" || status === "canceled" || status === "completed") continue;
    if (clean(appointment.reminderSentAt)) continue;
    const scheduledAt = parseAppointmentDateTime(appointment.appointmentDate, appointment.appointmentTime);
    if (!scheduledAt || scheduledAt < dueStart || scheduledAt > dueEnd) continue;
    const input = { ...appointment, event: "appointment_reminder" };
    const built = buildAppointmentPush(input);
    const result = await sendAppointmentPush(input);
    if (result.sent) {
      sent += 1;
      await saveNotification({
        appointment,
        event: built.event,
        title: built.title,
        body: built.body,
        data: built.data,
        push: result,
      });
      await markReminderSent(appointment.bookingId);
    }
    results.push({ bookingId: appointment.bookingId, appointmentAt: scheduledAt.toISOString(), result });
  }
  return { checked, dueEnd: dueEnd.toISOString(), dueStart: dueStart.toISOString(), results, sent };
}

module.exports = { runAppointmentReminders };
