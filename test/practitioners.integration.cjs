// Opt-in read-only integration checks against the configured LOCAL Frappe site.
// Set RUN_LOCAL_FRAPPE_TESTS=1, ERP_BASE_URL, ERP_TOKEN and APP_ERP_TOKEN.
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('local practitioner API, availability, auth and private photos', {
  skip: process.env.RUN_LOCAL_FRAPPE_TESTS !== '1',
}, async () => {
  assert.match(process.env.ERP_BASE_URL || '', /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
  const { createApp } = require('../src/app');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-erp-token': process.env.APP_ERP_TOKEN };
  try {
    assert.equal((await fetch(`${base}/api/v1/doctors`)).status, 401);
    const response = await fetch(`${base}/api/v1/doctors`, { headers });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.ok(data.doctors.length > 0);
    assert.ok(data.doctors.every(d => d.is_active && d.schedules.length > 0));
    const doctor = data.doctors[0];
    const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const path = `${base}/api/v1/doctors/${encodeURIComponent(doctor.id)}/availability`;
    assert.equal((await fetch(`${path}?date=bad`, { headers })).status, 400);
    const slotsResponse = await fetch(`${path}?date=${date}`, { headers });
    assert.equal(slotsResponse.status, 200);
    const slots = (await slotsResponse.json()).data.slots;
    assert.ok(Array.isArray(slots));
    assert.ok(slots.every(s => /^\d{2}:\d{2}:\d{2}$/.test(s.time) && s.duration > 0));
    const photo = data.doctors.find(d => d.image_url);
    if (photo) {
      const image = await fetch(`${base}${photo.image_url}`, { headers });
      assert.equal(image.status, 200);
      assert.match(image.headers.get('content-type'), /^image\//);
      assert.ok((await image.arrayBuffer()).byteLength > 0);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
