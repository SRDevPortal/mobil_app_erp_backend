const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mergeDoctorDirectoryMetrics} = require('../src/services/doctorDirectoryMetrics');

test('app metrics join by practitioner ID while scheduling and identity remain unchanged', () => {
  const doctors = [{id:'A', name:'Doctor A', schedules:[{id:'Schedule A'}], tags:['Kidney']}, {id:'B',name:'Doctor B'}];
  const result = mergeDoctorDirectoryMetrics(doctors, [{id:'B',doctor_rating:'4.3',experience_years:5,op_consulting_charge:499,online_consulting_charge:99,phone:'private'}]);
  assert.deepEqual(result[0], doctors[0]);
  assert.equal(result[1].name, 'Doctor B');
  assert.equal(result[1].rating, 4.3);
  assert.equal(result[1].experience_years, 5);
  assert.equal(result[1].opd_price, 499);
  assert.equal(result[1].online_price, 99);
  assert.equal(result[1].phone, undefined);
});

test('zero prices are preserved and missing or invalid metrics stay unset', () => {
  const [result] = mergeDoctorDirectoryMetrics([{id:'A'}], [{id:'A',doctor_rating:9,experience_years:-1,op_consulting_charge:0}]);
  assert.equal(result.rating, null);
  assert.equal(result.experience_years, null);
  assert.equal(result.opd_price, 0);
  assert.equal(result.online_price, null);
});
