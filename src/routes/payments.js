const express = require("express");
const {
  RAZORPAY_CURRENCY,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
} = require("../config");
const { erpCallMethod } = require('../frappeClient');
const { appAppointmentPricing } = require('../services/appAppointmentPricing');
const appointmentMeetings = require('../services/appointmentMeetings');
const {verifyAppointmentPayment} = require('../services/verifyAppointmentPayment');

const router = express.Router();

const clean = (value) => (value == null ? "" : String(value).trim());

async function appointmentPricing(body) {
  const id = clean(body.practitioner_id);
  if (!id) throw Object.assign(new Error('A practitioner ID is required'), {status: 400});
  const result = await erpCallMethod('mobile_app.api.doctor_directory.list_doctors');
  if (!Array.isArray(result.message?.doctors)) throw Object.assign(new Error('Doctor app pricing unavailable'), {status: 502});
  const profile = result.message.doctors.find(doctor => doctor.id === id && doctor.status === 'Active');
  return appAppointmentPricing(profile, body.appointment_type || body.appointmentType);
}

function requireRazorpayConfig(res) {
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) return true;
  res.status(503).json({
    success: false,
    message: "Razorpay is not configured on backend",
  });
  return false;
}

function makeReceipt(input) {
  const raw = clean(input) || `appt_${Date.now()}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
}


router.post("/razorpay/orders", async (req, res) => {
  if (!requireRazorpayConfig(res)) return;

  const body = req.body || {};
  let pricing;
  try {
    pricing = await appointmentPricing(body);
    if (pricing.appointment_type.toLowerCase().includes('online')) {
      await appointmentMeetings.ensureReady();
    }
    if (body.expected_amount != null && Number(body.expected_amount) !== pricing.amount) {
      return res.status(409).json({success: false, message: 'Consultation fee changed. Refresh the doctor list and review the new fee.'});
    }
  } catch (error) {
    return res.status(error.status || 502).json({success: false, message: error.status ? error.message : 'Doctor app pricing unavailable'});
  }
  if (!Number.isFinite(pricing.amount) || pricing.amount <= 0) {
    return res.status(400).json({ success: false, message: "Invalid appointment amount" });
  }

  const receipt = makeReceipt(body.receipt || body.booking_id || body.bookingId);
  const notes = {
    ...(req.authUser?.id ? {supabase_user_id: req.authUser.id} : {}),
    practitioner_id: clean(body.practitioner_id),
    appointment_type: pricing.appointment_type,
    doctor_name: clean(body.doctor_name || body.doctorName),
    patient_name: clean(body.patient_name || body.patientName),
    patient_email: clean(body.patient_email || body.patientEmail || body.email),
    patient_phone: clean(body.patient_phone || body.patientPhone || body.phone),
    payable_at_clinic: String(pricing.payable_at_clinic),
  };

  try {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64");
    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: pricing.amount,
        currency: RAZORPAY_CURRENCY,
        receipt,
        notes,
      }),
    });

    const raw = await rpRes.text();
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (_) {
      parsed = { raw };
    }

    if (!rpRes.ok) {
      return res.status(rpRes.status).json({
        success: false,
        message: parsed?.error?.description || "Razorpay order creation failed",
        data: parsed,
      });
    }

    return res.json({
      success: true,
      data: {
        key_id: RAZORPAY_KEY_ID,
        order_id: parsed.id,
        amount: parsed.amount,
        currency: parsed.currency || RAZORPAY_CURRENCY,
        receipt: parsed.receipt || receipt,
        appointment_type: pricing.appointment_type,
        payable_at_clinic: pricing.payable_at_clinic,
      },
    });
  } catch (e) {
    console.error("[payments] Razorpay order failed", e);
    return res.status(502).json({ success: false, message: "Razorpay order request failed" });
  }
});

router.post("/razorpay/verify", async (req, res) => {
  if (!requireRazorpayConfig(res)) return;

  try {
    const data = await verifyAppointmentPayment(req.body || {}, req.authUser?.id);
    return res.json({success: true, data});
  } catch (error) {
    return res.status(error.status || 502).json({success: false, message: error.message});
  }
});

module.exports = router;
