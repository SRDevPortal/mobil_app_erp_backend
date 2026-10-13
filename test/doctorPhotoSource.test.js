const { test } = require('node:test');
const assert = require('node:assert/strict');
const { doctorPhotoSource } = require('../src/services/doctorPhotoSource');
const crm = 'https://dev-sr.butest.tech';
const credentials = { Authorization: 'token test-only', 'X-ERP-Token': 'test-only' };

test('public S3 doctor photos never receive CRM credentials', () => {
  const source = doctorPhotoSource('https://sriaas-frappe-test.s3.ap-south-1.amazonaws.com/doctor/a.jpg', crm, credentials);
  assert.equal(source.url.pathname, '/doctor/a.jpg');
  assert.deepEqual(source.headers, {});
});

test('public and private CRM files retain authentication', () => {
  for (const path of ['/files/a.jpg', '/private/files/a.jpg']) {
    const source = doctorPhotoSource(path, crm, credentials);
    assert.equal(source.url.origin, crm);
    assert.deepEqual(source.headers, credentials);
  }
});

test('untrusted hosts, paths, schemes and embedded credentials are rejected', () => {
  for (const url of [
    'https://example.com/doctor/a.jpg',
    'https://sriaas-frappe-test.s3.ap-south-1.amazonaws.com/prescriptions/a.jpg',
    'https://sriaas-frappe-test.s3.ap-south-1.amazonaws.com/doctor/../prescriptions/a.jpg',
    'http://sriaas-frappe-test.s3.ap-south-1.amazonaws.com/doctor/a.jpg',
    'https://user:password@dev-sr.butest.tech/files/a.jpg',
    '/api/resource/User',
  ]) assert.equal(doctorPhotoSource(url, crm, credentials), null);
});
