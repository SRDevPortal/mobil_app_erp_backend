function appAppointmentPricing(profile, appointmentType) {
  if (!profile) throw Object.assign(new Error('Doctor app settings not found'), {status: 404});
  const online = /online|meet\.google\.com/i.test(String(appointmentType));
  if (!(online ? profile.accepts_online_appointments : profile.accepts_opd_appointments)) {
    throw Object.assign(new Error('Doctor does not accept this consultation mode'), {status: 409});
  }
  const raw = online ? profile.online_consulting_charge : profile.op_consulting_charge;
  const fee = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  const amount = Math.round(fee * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw Object.assign(new Error('Consultation fee is not configured for this doctor'), {status: 409});
  }
  return {appointment_type: online ? 'Online Consultation' : 'OPD Consultation', amount, payable_at_clinic: 0};
}
module.exports = { appAppointmentPricing };
