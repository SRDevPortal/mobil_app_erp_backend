const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
let configured=true, erpSuccess=true, authFails=false, calls=[];
require.cache[require.resolve('../src/supabaseAuth')]={exports:{
  requireAccountDeletionConfig:()=>{if(!configured)throw Object.assign(new Error('Not configured'),{status:503});},
  deleteSupabaseUser:async uid=>{calls.push(`auth:${uid}`);if(authFails)throw Object.assign(new Error('Auth unavailable'),{status:502});},
}};
require.cache[require.resolve('../src/services/userService')]={exports:{findMobileAppUser:async()=>({name:'ERP-test-user'})}};
require.cache[require.resolve('../src/frappeClient')]={exports:{erpCallMethod:async(method,options)=>{
  calls.push(`erp:${options.body.supabase_user_id}`);
  return {message:erpSuccess?{success:true,data:{deleted:{'Mobile App User':1}}}:{success:false}};
}}};
const router=require('../src/routes/account');
let server,base;
before(async()=>{const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.get('x-test-user'))req.authUser={id:req.get('x-test-user')};next();});app.use(router);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(()=>new Promise(r=>server.close(r)));
const remove=(body={confirmation:'DELETE'},user='disposable-test-user')=>fetch(base,{method:'DELETE',headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{})},body:JSON.stringify(body)});
test('deletion requires an authenticated user and explicit confirmation',async()=>{calls=[];assert.equal((await remove({},'')).status,403);assert.equal((await remove({confirmation:'delete'})).status,400);assert.deepEqual(calls,[]);});
test('missing auth service config cannot partially delete ERP records',async()=>{configured=false;calls=[];try{assert.equal((await remove()).status,503);assert.deepEqual(calls,[]);}finally{configured=true;}});
test('ERP deletion must be confirmed before removing sign-in identity',async()=>{erpSuccess=false;calls=[];try{assert.equal((await remove()).status,502);assert.deepEqual(calls,['erp:disposable-test-user']);}finally{erpSuccess=true;}});
test('successful deletion removes ERP then the same authenticated account',async()=>{calls=[];const res=await remove({confirmation:'DELETE',supabase_user_id:'another-user'});assert.equal(res.status,200);assert.deepEqual(calls,['erp:disposable-test-user','auth:disposable-test-user']);});
test('auth deletion failure remains retryable and never reports success',async()=>{authFails=true;try{assert.equal((await remove()).status,502);}finally{authFails=false;}assert.equal((await remove()).status,200);});
