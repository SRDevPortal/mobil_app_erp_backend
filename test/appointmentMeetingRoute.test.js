const {test,before,after} = require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
let saved, existing=[], meetingCalls=0, rejectBooking=false, failMeeting=false;
require.cache[require.resolve('../src/services/userService')]={exports:{findMobileAppUser:async()=>({name:'ERP-user',external_id:'u1'})}};
require.cache[require.resolve('../src/services/verifyAppointmentPayment')]={exports:{verifyAppointmentPayment:async body=>{
  if(body.razorpay_signature!=='valid-test-signature')throw Object.assign(new Error('Invalid signature'),{status:400});
  return {payment_status:'paid',paid_amount:9900};
}}};
require.cache[require.resolve('../src/services/appointmentMeetings')]={exports:{ensureMeeting:async body=>{
  meetingCalls++;
  if(failMeeting)throw Object.assign(new Error('Unavailable'),{status:503});
  return {meeting_link:body.bookingId==='booking1'?'https://meet.google.com/abc-defg-hij':'https://meet.google.com/klm-nopq-rst',meeting_event_id:body.bookingId};
}}};
require.cache[require.resolve('../src/frappeClient')]={exports:{erpGetList:async()=>existing,erpCallMethod:async(method,options)=>{
  assert.equal(method,'mobile_app.api.practitioners.book_appointment');
  if(rejectBooking)throw Object.assign(new Error('Slot taken'),{status:409});
  saved=options.body.appointment;
  return {message:{booking_id:saved.booking_id}};
}}};
const router=require('../src/routes/appointments');
let server,base;
before(async()=>{const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={id:'u1'};next();});app.use(router);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(()=>new Promise(r=>server.close(r)));
const booking={external_id:'u1',booking_id:'booking1',practitioner_id:'P1',appointment_date:'2026-10-20',appointment_time:'2:30 PM',appointment_type:'Online Consultation',razorpay_signature:'valid-test-signature',status:'Confirmed'};
const post=body=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('server meeting replaces caller URL, persists to ERP and returns to Flutter',async()=>{
  const response=await post({...booking,consultation_type:'https://meet.google.com/xxx-xxxx-xxx'});
  assert.equal(response.status,201);
  assert.equal((await response.json()).data.meeting_link,'https://meet.google.com/abc-defg-hij');
  assert.equal(saved.consultation_type,'https://meet.google.com/abc-defg-hij');
  assert.equal(JSON.parse(saved.payload_json).meeting_event_id,'booking1');
  assert.equal(JSON.parse(saved.payload_json).paid_amount,9900);
  const second=await post({...booking,booking_id:'booking2'});
  assert.equal((await second.json()).data.meeting_link,'https://meet.google.com/klm-nopq-rst');
});
test('unsigned paid claims cannot create a room or an ERP booking',async()=>{
  const calls=meetingCalls;saved=null;
  assert.equal((await post({...booking,razorpay_signature:'forged',payment_status:'paid'})).status,400);
  assert.equal(saved,null);assert.equal(meetingCalls,calls);
});
test('OPD keeps its consultation mode and creates no meeting',async()=>{
  const calls=meetingCalls;
  assert.equal((await post({...booking,appointment_type:'OPD Consultation'})).status,201);
  assert.equal(saved.consultation_type,'OPD Consultation');assert.equal(meetingCalls,calls);
});
test('meeting outage and ERP conflict never report a confirmed booking',async()=>{
  failMeeting=true;saved=null;
  assert.equal((await post(booking)).status,503);assert.equal(saved,null);
  failMeeting=false;rejectBooking=true;
  assert.equal((await post(booking)).status,409);assert.equal(saved,null);
  rejectBooking=false;
});
test('existing booking ownership and consultation mode are enforced before rescheduling',async()=>{
  existing=[{mobile_app_user:'another-user',consultation_type:'OPD Consultation'}];
  assert.equal((await post(booking)).status,403);
  existing=[{mobile_app_user:'ERP-user',consultation_type:'OPD Consultation'}];
  assert.equal((await post(booking)).status,409);
  existing=[];
});
