const crypto = require("crypto");
const express = require("express");
const {
  RAZORPAY_CURRENCY,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
} = require("../config");
const { erpCallMethod } = require('../frappeClient');
const { appAppointmentPricing } = require('../services/appAppointmentPricing');

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

function safeEqualHex(left, right) {
  const a = Buffer.from(clean(left), "hex");
  const b = Buffer.from(clean(right), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post("/razorpay/orders", async (req, res) => {
  if (!requireRazorpayConfig(res)) return;

  const body = req.body || {};
  let pricing;
  try {
    pricing = await appointmentPricing(body);
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

  const body = req.body || {};
  const orderId = clean(body.razorpay_order_id || body.order_id || body.orderId);
  const paymentId = clean(body.razorpay_payment_id || body.payment_id || body.paymentId);
  const signature = clean(body.razorpay_signature || body.signature);

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ success: false, message: "Missing Razorpay payment verification fields" });
  }

  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  if (!safeEqualHex(signature, expected)) {
    return res.status(400).json({ success: false, message: "Invalid Razorpay signature" });
  }

  // Use the order's original server amount, even if ERP fees changed after checkout.
  let order;
  try {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
      headers: {Authorization: `Basic ${auth}`}, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return res.status(502).json({success: false, message: 'Unable to verify payment order'});
    order = await response.json();
    if (order.id !== orderId || !Number.isSafeInteger(order.amount) || order.amount <= 0 ||
        (body.practitioner_id && order.notes?.practitioner_id !== body.practitioner_id)) {
      return res.status(400).json({success: false, message: 'Payment order does not match this appointment'});
    }
  } catch (_) {
    return res.status(502).json({success: false, message: 'Unable to verify payment order'});
  }
  return res.json({
    success: true,
    data: {
      verified: true,
      payment_provider: "razorpay",
      payment_status: "paid",
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      paid_amount: order.amount,
      currency: order.currency,
      payable_at_clinic: Number(order.notes?.payable_at_clinic || 0),
    },
  });
});

module.exports = router;
