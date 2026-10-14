const test = require('node:test');
const assert = require('node:assert/strict');

let appointments = [];
let deliveries = [];
let notifications = [];
function mockModule(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
mockModule('../src/config', {
  APPOINTMENT_TIMEZONE_OFFSET_MINUTES: 330,
  REMINDER_BEFORE_MINUTES: 120,
  REMINDER_LOOKAHEAD_MINUTES: 15,
});
mockModule('../src/services/notificationStore', {
  readAppointments: async () => appointments,
  markReminderSent: async (id) => { appointments.find(a => a.bookingId === id).reminderSentAt = 'sent'; },
  saveNotification: async (item) => notifications.push(item),
});
mockModule('../src/services/pushService', {
  buildAppointmentPush: input => ({event: input.event, title: 'Reminder', body: 'Reminder', data: {bookingId: input.bookingId}}),
  sendAppointmentPush: async input => { deliveries.push(input); return {sent: true}; },
});
const { runAppointmentReminders } = require('../src/services/reminderService');

test('IST appointment receives one reminder two hours before, never duplicated', async () => {
  appointments = [{bookingId: 'test', appointmentDate: '2026-10-14', appointmentTime: '14:00', status: 'Confirmed'}];
  deliveries = []; notifications = [];
  await runAppointmentReminders({now: '2026-10-14T06:31:00Z'});
  await runAppointmentReminders({now: '2026-10-14T06:32:00Z'});
  assert.equal(deliveries.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(deliveries[0].event, 'appointment_reminder');
});

test('rescheduled time replaces the old reminder; cancelled bookings are skipped', async () => {
  appointments = [
    {bookingId: 'moved', appointmentDate: '2026-10-14', appointmentTime: '16:00', status: 'Rescheduled', reminderSentAt: ''},
    {bookingId: 'cancelled', appointmentDate: '2026-10-14', appointmentTime: '14:00', status: 'Cancelled'},
  ];
  deliveries = []; notifications = [];
  await runAppointmentReminders({now: '2026-10-14T06:31:00Z'});
  assert.equal(deliveries.length, 0);
  await runAppointmentReminders({now: '2026-10-14T08:31:00Z'});
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].bookingId, 'moved');
});
