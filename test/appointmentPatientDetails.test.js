const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mapAppointmentChildRowForFullSync} = require('../src/normalize');
test('patient details persist alongside verified payment metadata in appointment payload', () => {
  const row = mapAppointmentChildRowForFullSync({
    patient_name:'Test Patient', patient_age:34, patient_gender:'Female',
    chief_complaint:'Follow-up consultation', payment_status:'paid', paid_amount:14900,
  }, 'test-user');
  const payload = JSON.parse(row.payload_json);
  assert.equal(payload.patient_age,34);
  assert.equal(payload.patient_gender,'Female');
  assert.equal(payload.chief_complaint,'Follow-up consultation');
  assert.equal(payload.paid_amount,14900);
  assert.equal(payload.payment_status,'paid');
});
