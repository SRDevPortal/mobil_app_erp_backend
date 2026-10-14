const crypto = require('crypto');

const unavailable = () => Object.assign(new Error('Online consultation meetings are temporarily unavailable. Please contact support or choose OPD.'), {status: 503});

// Calendar event IDs are deterministic so retries (including a process restart)
// retrieve the same conference instead of creating another room for a booking.
function eventIdForBooking(userId, bookingId) {
  if (!userId || !bookingId) throw Object.assign(new Error('Booking identity is required for an online appointment'), {status: 400});
  return crypto.createHash('sha256').update(JSON.stringify([userId, bookingId])).digest('hex');
}

function meetingUrl(event) {
  const value = event?.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri || event?.hangoutLink;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'meet.google.com' && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(url.pathname)
      ? url.toString() : null;
  } catch (_) { return null; }
}

function appointmentTimes(date, time, duration = 30) {
  const match = String(time || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !match) throw Object.assign(new Error('Valid appointment date and time are required'), {status: 400});
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) throw Object.assign(new Error('Invalid appointment time'), {status: 400});
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  const start = `${date}T${String(hour).padStart(2, '0')}:${match[2]}:00+05:30`;
  const timestamp = Date.parse(start);
  if (!Number.isFinite(timestamp) || new Date(timestamp + 330 * 60000).toISOString().slice(0, 10) !== date) throw Object.assign(new Error('Invalid appointment date'), {status: 400});
  return {start: {dateTime: start, timeZone: 'Asia/Kolkata'}, end: {dateTime: new Date(timestamp + duration * 60000).toISOString(), timeZone: 'Asia/Kolkata'}};
}

function createMeetingService({env = process.env, request = (...args) => fetch(...args), pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  let token;
  let expires = 0;
  async function accessToken(signal) {
    if (!env.GOOGLE_MEET_CLIENT_ID || !env.GOOGLE_MEET_CLIENT_SECRET || !env.GOOGLE_MEET_REFRESH_TOKEN) throw unavailable();
    if (token && Date.now() < expires) return token;
    const response = await request('https://oauth2.googleapis.com/token', {method: 'POST', signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: env.GOOGLE_MEET_CLIENT_ID, client_secret: env.GOOGLE_MEET_CLIENT_SECRET,
        refresh_token: env.GOOGLE_MEET_REFRESH_TOKEN, grant_type: 'refresh_token'}).toString()});
    if (!response.ok) throw unavailable();
    const data = await response.json();
    if (!data.access_token) throw unavailable();
    token = data.access_token;
    expires = Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000;
    return token;
  }
  function calendarPath() {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_MEET_CALENDAR_ID || 'primary')}/events`;
  }
  async function ensureReady() {
    try {
      const signal = AbortSignal.timeout(10000);
      const auth = await accessToken(signal);
      const response = await request(`${calendarPath()}?maxResults=1`, {signal, headers: {Authorization: `Bearer ${auth}`}});
      if (!response.ok) throw unavailable();
    } catch (_) { throw unavailable(); }
  }
  async function ensureMeeting({userId, bookingId, date, time, updateExistingTime = false}) {
    const id = eventIdForBooking(userId, bookingId);
    const times = appointmentTimes(date, time);
    try {
      const signal = AbortSignal.timeout(20000);
      const auth = await accessToken(signal);
      const headers = {Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json'};
      const eventPath = `${calendarPath()}/${id}`;
      let response = await request(eventPath, {signal, headers});
      let event;
      if (response.status === 404) {
        response = await request(`${calendarPath()}?conferenceDataVersion=1&sendUpdates=none`, {method: 'POST', signal, headers,
          body: JSON.stringify({id, summary: 'SRIAAS Online Consultation', ...times,
            conferenceData: {createRequest: {requestId: id, conferenceSolutionKey: {type: 'hangoutsMeet'}}}})});
        if (response.status === 409) response = await request(eventPath, {signal, headers});
        if (!response.ok) throw unavailable();
        event = await response.json();
      } else {
        if (!response.ok) throw unavailable();
        event = await response.json();
        if (event.status === 'cancelled') throw unavailable();
        if (updateExistingTime && Date.parse(event.start?.dateTime) !== Date.parse(times.start.dateTime)) {
          response = await request(`${eventPath}?conferenceDataVersion=1&sendUpdates=none`, {method: 'PATCH', signal, headers, body: JSON.stringify(times)});
          if (!response.ok) throw unavailable();
          event = await response.json();
        }
      }
      for (let attempt = 0; !meetingUrl(event) && attempt < 3; attempt++) {
        if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') throw unavailable();
        await pause(250);
        response = await request(eventPath, {signal, headers});
        if (!response.ok) throw unavailable();
        event = await response.json();
      }
      const url = meetingUrl(event);
      if (!url) throw unavailable();
      return {meeting_link: url, meeting_event_id: id};
    } catch (_) { throw unavailable(); }
  }
  return {ensureReady, ensureMeeting};
}

module.exports = {...createMeetingService(), createMeetingService, eventIdForBooking, appointmentTimes, meetingUrl};
