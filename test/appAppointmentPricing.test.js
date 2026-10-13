const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appAppointmentPricing } = require('../src/services/appAppointmentPricing');
const profile = {accepts_online_appointments:true, accepts_opd_appointments:true, op_consulting_charge:750.5, online_consulting_charge:149};
test('selected mode uses exact app-specific fee and adds no clinic balance', () => {
  assert.deepEqual(appAppointmentPricing(profile, 'Online Consultation'), {appointment_type:'Online Consultation', amount:14900, payable_at_clinic:0});
  assert.deepEqual(appAppointmentPricing(profile, 'OPD Consultation'), {appointment_type:'OPD Consultation', amount:75050, payable_at_clinic:0});
});
test('zero, unset and negative prices cannot silently use a default fee', () => {
  for (const fee of [0, null, undefined, '', -1, 'invalid']) {
    assert.throws(() => appAppointmentPricing({...profile, online_consulting_charge:fee}, 'Online Consultation'), {status:409});
  }
});
test('missing doctors and disabled consultation modes cannot create orders', () => {
  assert.throws(() => appAppointmentPricing(null,'OPD'), {status:404});
  assert.throws(() => appAppointmentPricing({...profile,accepts_online_appointments:false},'Online'), {status:409});
});
