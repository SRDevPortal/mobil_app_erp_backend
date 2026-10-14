const {test,after}=require('node:test');
const assert=require('node:assert/strict');
process.env.ONESIGNAL_APP_ID='test-app';process.env.ONESIGNAL_REST_API_KEY='test-key';
const {sendAppointmentPush}=require('../src/services/pushService');
const original=global.fetch;after(()=>global.fetch=original);
test('HTTP 200 with zero recipients or provider errors is not a sent push',async()=>{
  for(const detail of [{id:'test-message',recipients:0},{id:'',errors:['All recipients are unsubscribed']},{}]) {
    global.fetch=async()=>new Response(JSON.stringify(detail));
    const result=await sendAppointmentPush({oneSignalPushToken:'test-subscription',event:'booking_confirmed'});
    assert.equal(result.sent,false);
  }
});
test('accepted push targets only supplied subscription and carries booking navigation data',async()=>{
  global.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.deepEqual(body.include_subscription_ids,['test-subscription']);
    assert.equal(body.data.bookingId,'test-booking');
    assert.equal(body.data.screen,'appointment_details');
    return new Response(JSON.stringify({id:'test-message',recipients:1}));
  };
  const result=await sendAppointmentPush({oneSignalPushToken:'test-subscription',event:'booking_confirmed',bookingId:'test-booking'});
  assert.equal(result.sent,true);
});
