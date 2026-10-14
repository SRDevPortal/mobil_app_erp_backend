const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.RAZORPAY_KEY_ID='test-key';
process.env.RAZORPAY_KEY_SECRET='test-secret';
const {verifyAppointmentPayment} = require('../src/services/verifyAppointmentPayment');
const original = global.fetch;
after(()=>global.fetch=original);
const body = {practitioner_id:'P1',booking_id:'booking1',razorpay_order_id:'order_1',razorpay_payment_id:'pay_1',
  razorpay_signature:crypto.createHmac('sha256','test-secret').update('order_1|pay_1').digest('hex')};
function provider({payment = {}, order = {}} = {}) {
  global.fetch=async url=>new Response(JSON.stringify(String(url).includes('/payments/') ?
    {id:'pay_1',order_id:'order_1',amount:9900,currency:'INR',status:'captured',captured:true,...payment} :
    {id:'order_1',receipt:'booking1',amount:9900,currency:'INR',notes:{practitioner_id:'P1',supabase_user_id:'u1',appointment_type:'Online Consultation'},...order}));
}
test('captured payment is verified using provider amount and authenticated owner',async()=>{
  provider(); assert.equal((await verifyAppointmentPayment({...body,paid_amount:1},'u1')).paid_amount,9900);
});
test('authorized, failed and refunded payments cannot confirm an appointment',async()=>{
  for(const status of ['authorized','failed','refunded']) {
    provider({payment:{status,captured:status==='refunded'}});
    await assert.rejects(verifyAppointmentPayment(body,'u1'),{status:409});
  }
});
test('payment/order mismatch, another patient and replay on another booking are rejected',async()=>{
  provider({payment:{order_id:'order_other'}}); await assert.rejects(verifyAppointmentPayment(body,'u1'),{status:400});
  provider(); await assert.rejects(verifyAppointmentPayment(body,'u2'),{status:400});
  await assert.rejects(verifyAppointmentPayment({...body,booking_id:'booking2'},'u1'),{status:400});
});
test('invalid signatures cannot call the payment provider',async()=>{
  global.fetch=()=>assert.fail('Provider must not be called');
  await assert.rejects(verifyAppointmentPayment({...body,razorpay_signature:'0'.repeat(64)},'u1'),{status:400});
});
test('an online payment cannot be reused for an OPD appointment',async()=>{
  provider();
  await assert.rejects(verifyAppointmentPayment({...body,appointment_type:'OPD Consultation'},'u1'),{status:400});
});
test('older client without booking signature still requires captured payment and server-bound owner',async()=>{
  provider();
  assert.equal((await verifyAppointmentPayment({...body,razorpay_signature:''},'u1',{allowMissingSignature:true})).verified,true);
  await assert.rejects(verifyAppointmentPayment({...body,razorpay_signature:''},'u2',{allowMissingSignature:true}),{status:400});
  await assert.rejects(verifyAppointmentPayment({...body,razorpay_signature:''},undefined,{allowMissingSignature:true}),{status:400});
});
