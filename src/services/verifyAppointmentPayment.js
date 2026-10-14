const crypto = require('crypto');
const {RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET} = require('../config');

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
async function verifyAppointmentPayment(body, userId, {allowMissingSignature = false} = {}) {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) throw fail('Razorpay is not configured on backend', 503);
  const orderId = String(body.razorpay_order_id || body.order_id || '').trim();
  const paymentId = String(body.razorpay_payment_id || body.payment_id || '').trim();
  const signature = String(body.razorpay_signature || body.signature || '').trim();
  if (!orderId || !paymentId) throw fail('Missing Razorpay payment verification fields');
  // Older mobile builds omit the signature on the booking request. They can
  // still save only a captured provider payment bound to this authenticated
  // owner, practitioner and booking receipt by the server-created order.
  if (signature || !allowMissingSignature || !userId || !body.booking_id || !body.practitioner_id) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) throw fail('Missing or invalid Razorpay payment verification fields');
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest();
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected)) throw fail('Invalid Razorpay signature');
  }
  const headers = {Authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`};
  let order, payment;
  try {
    const responses = await Promise.all([
      fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {headers, signal: AbortSignal.timeout(10000)}),
      fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {headers, signal: AbortSignal.timeout(10000)}),
    ]);
    if (responses.some(r => !r.ok)) throw new Error();
    [order, payment] = await Promise.all(responses.map(r => r.json()));
  } catch (_) { throw fail('Unable to verify payment with Razorpay', 502); }
  if (order.id !== orderId || !Number.isSafeInteger(order.amount) || order.amount <= 0 ||
      (body.practitioner_id && order.notes?.practitioner_id !== body.practitioner_id) ||
      (userId && order.notes?.supabase_user_id !== userId) ||
      (body.booking_id && order.receipt !== String(body.booking_id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)) ||
      payment.id !== paymentId || payment.order_id !== orderId || payment.amount !== order.amount || payment.currency !== order.currency) {
    throw fail('Payment order does not match this appointment');
  }
  const consultation = body.consultation_type || body.appointment_type;
  if (consultation && /online|meet\.google\.com/i.test(String(consultation)) !==
      /online|meet\.google\.com/i.test(String(order.notes?.appointment_type))) {
    throw fail('Payment consultation mode does not match this appointment');
  }
  if (payment.status !== 'captured' || payment.captured !== true) throw fail('Payment has not been captured. Do not pay again; contact support with your payment ID.', 409);
  return {verified: true, payment_provider: 'razorpay', payment_status: 'paid', razorpay_order_id: orderId,
    razorpay_payment_id: paymentId, paid_amount: order.amount, currency: order.currency,
    payable_at_clinic: Number(order.notes?.payable_at_clinic || 0)};
}
module.exports = {verifyAppointmentPayment};
