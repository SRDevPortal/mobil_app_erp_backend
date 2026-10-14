const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createMeetingService, eventIdForBooking, appointmentTimes, meetingUrl} = require('../src/services/appointmentMeetings');
const env = {GOOGLE_MEET_CLIENT_ID:'test-client', GOOGLE_MEET_CLIENT_SECRET:'test-secret', GOOGLE_MEET_REFRESH_TOKEN:'test-refresh'};
const json = (data, status = 200) => new Response(JSON.stringify(data), {status});

test('Google creates distinct rooms for different appointments; retries reuse the saved event', async () => {
  const events = new Map(); let created = 0;
  const service = createMeetingService({env, request: async (url, options = {}) => {
    if (url.includes('oauth2')) return json({access_token:'test-token', expires_in:3600});
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.attendees, undefined);
      assert.equal(body.summary, 'SRIAAS Online Consultation');
      assert.equal(body.conferenceData.createRequest.requestId, body.id);
      const event = {...body, hangoutLink: ++created === 1 ? 'https://meet.google.com/abc-defg-hij' : 'https://meet.google.com/klm-nopq-rst'};
      events.set(body.id, event); return json(event);
    }
    const event = events.get(url.split('/').pop());
    return event ? json(event) : json({},404);
  }});
  const booking = {userId:'patient1', bookingId:'booking1', date:'2026-10-20', time:'2:30 PM'};
  const first = await service.ensureMeeting(booking);
  assert.deepEqual(await service.ensureMeeting(booking), first);
  const second = await service.ensureMeeting({...booking, bookingId:'booking2'});
  assert.notEqual(first.meeting_link, second.meeting_link);
  assert.equal(created, 2);
  assert.notEqual(eventIdForBooking('patient1','booking1'),eventIdForBooking('patient2','booking1'));
});

test('concurrent insert conflict retrieves the same Google event', async () => {
  let reads = 0;
  const service = createMeetingService({env, request: async (url, options = {}) => {
    if (url.includes('oauth2')) return json({access_token:'token'});
    if (options.method === 'POST') return json({},409);
    return ++reads === 1 ? json({},404) : json({hangoutLink:'https://meet.google.com/abc-defg-hij'});
  }});
  assert.equal((await service.ensureMeeting({userId:'u',bookingId:'b',date:'2026-10-20',time:'14:30:00'})).meeting_link,'https://meet.google.com/abc-defg-hij');
});

test('asynchronous conference creation is polled; a fabricated or failed link is never returned', async () => {
  let reads = 0;
  const service = createMeetingService({env, pause:async()=>{}, request: async (url, options = {}) => {
    if (url.includes('oauth2')) return json({access_token:'token'});
    if (options.method === 'POST') return json({conferenceData:{createRequest:{status:{statusCode:'pending'}}}});
    return ++reads === 1 ? json({},404) : json({conferenceData:{entryPoints:[{entryPointType:'video',uri:'https://meet.google.com/abc-defg-hij'}]}});
  }});
  assert.equal((await service.ensureMeeting({userId:'u',bookingId:'b',date:'2026-10-20',time:'14:30'})).meeting_link,'https://meet.google.com/abc-defg-hij');
  assert.equal(meetingUrl({hangoutLink:'https://meet.google.com.evil.test/abc-defg-hij'}),null);
});

test('rescheduling updates time while keeping the appointment conference', async () => {
  let patched = false;
  const service = createMeetingService({env, request: async (url, options = {}) => {
    if (url.includes('oauth2')) return json({access_token:'token'});
    if (options.method === 'PATCH') {patched = true; assert.equal(JSON.parse(options.body).start.dateTime,'2026-10-21T15:00:00+05:30');}
    return json({start:{dateTime:'2026-10-20T14:30:00+05:30'},hangoutLink:'https://meet.google.com/abc-defg-hij'});
  }});
  assert.equal((await service.ensureMeeting({userId:'u',bookingId:'b',date:'2026-10-21',time:'3:00 PM',updateExistingTime:true})).meeting_link,'https://meet.google.com/abc-defg-hij');
  assert.equal(patched,true);
});

test('missing credentials and provider failures return a safe unavailable error', async () => {
  await assert.rejects(createMeetingService({env:{}}).ensureReady(), {status:503});
  const service = createMeetingService({env, request: async () => json({error:'private provider details'},401)});
  await assert.rejects(service.ensureReady(), error => error.status === 503 && !error.message.includes('private'));
});

test('appointment time validation and IST rollover are correct', () => {
  assert.equal(appointmentTimes('2026-10-20','12:00 AM').start.dateTime,'2026-10-20T00:00:00+05:30');
  assert.equal(appointmentTimes('2026-10-20','11:50 PM').end.dateTime,'2026-10-20T18:50:00.000Z');
  for (const [date,time] of [['2026-02-30','12:00'],['2026-10-20','24:00'],['2026-10-20','0:00 PM'],['bad','12:30']]) {
    assert.throws(()=>appointmentTimes(date,time),{status:400});
  }
});
