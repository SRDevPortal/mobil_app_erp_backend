const test = require('node:test');
const assert = require('node:assert/strict');
const { createDoctorPhotoCache } = require('../src/services/doctorPhotoCache');

test('concurrent requests share a download and expired photos refresh', async () => {
  let time = 0;
  let calls = 0;
  const cache = createDoctorPhotoCache({ ttlMs: 10, now: () => time });
  const load = async () => ({ type: 'image/jpeg', body: Buffer.from(String(++calls)) });
  const [first, second] = await Promise.all([cache.get('a', load), cache.get('a', load)]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  await cache.get('a', load);
  assert.equal(calls, 1);
  time = 11;
  await cache.get('a', load);
  assert.equal(calls, 2);
});

test('failed downloads retry and the byte limit evicts old photos', async () => {
  const cache = createDoctorPhotoCache({ maxBytes: 2 });
  await assert.rejects(cache.get('a', async () => { throw new Error('offline'); }));
  let calls = 0;
  const load = async () => { calls++; return { type: 'image/jpeg', body: Buffer.from('ab') }; };
  await cache.get('a', load);
  await cache.get('b', load);
  await cache.get('a', load);
  assert.equal(calls, 3);
});
