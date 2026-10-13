const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
process.env.RAZORPAY_KEY_ID = 'test-key';
process.env.RAZORPAY_KEY_SECRET = 'test-secret';
const clientPath = require.resolve('../src/frappeClient');
require.cache[clientPath] = {exports:{erpCallMethod: async () => ({message:{doctors:[{
  id:'P1', status:'Active', accepts_online_appointments:true,
  accepts_opd_appointments:true, online_consulting_charge:299, op_consulting_charge:650,
}]}})}};
const router = require('../src/routes/payments');
const realFetch = global.fetch;
let server, base, razorpayCalls;
before(async () => {
  const app = express(); app.use(express.json()); app.use(router);
  server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  global.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://api.razorpay.com/v1/orders'));
    razorpayCalls++;
    const body = options.method === 'POST' ? JSON.parse(options.body) : {};
    return new Response(JSON.stringify({id:'order_1',amount:body.amount || 29900,currency:'INR',
      notes:{practitioner_id:'P1',payable_at_clinic:'0'}}), {status:200});
  };
});
after(async () => {
  global.fetch = realFetch;
  await new Promise(resolve=>server.close(resolve));
});
const post = (path, body) => realFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('order amount comes from app profile, ignoring caller-supplied amount', async () => {
  const response = await post('/razorpay/orders',{practitioner_id:'P1',appointment_type:'Online',expected_amount:29900,amount:1});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.data.amount,29900);
  assert.equal(result.data.payable_at_clinic,0);
});
test('changed displayed fee is rejected before creating a Razorpay order', async () => {
  razorpayCalls = 0;
  const response = await post('/razorpay/orders',{practitioner_id:'P1',appointment_type:'Online',expected_amount:9900});
  assert.equal(response.status,409);
  assert.equal(razorpayCalls,0);
});
test('verification uses original order amount instead of edited client metadata', async () => {
  const signature = crypto.createHmac('sha256','test-secret').update('order_1|pay_1').digest('hex');
  const response = await post('/razorpay/verify',{practitioner_id:'P1',razorpay_order_id:'order_1',razorpay_payment_id:'pay_1',razorpay_signature:signature,amount:1,currency:'USD',payable_at_clinic:50000});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.data.paid_amount,29900);
  assert.equal(result.data.currency,'INR');
  assert.equal(result.data.payable_at_clinic,0);
});
