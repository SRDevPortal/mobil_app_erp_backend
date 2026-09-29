// Read-only check of the authoritative CRM. Run from backend/backend-erp.
const { ERP_BASE_URL } = require('../src/config');
const { erpGetList, erpGetDoc } = require('../src/frappeClient');

async function names(doctype) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await erpGetList(doctype, { fields: ['name'], limit: 100, offset, orderBy: 'name asc' });
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

async function main() {
  if (new URL(ERP_BASE_URL).origin !== 'https://dev-sr.butest.tech') {
    throw new Error('Expected ERP_BASE_URL=https://dev-sr.butest.tech; no requests were sent.');
  }
  console.log(`Authoritative CRM: ${ERP_BASE_URL}`);
  const practitioners = await names('Healthcare Practitioner');
  const schedules = await names('Practitioner Schedule');
  const scheduleNames = new Set(schedules.map(row => row.name));
  for (const row of practitioners) {
    const doctor = await erpGetDoc('Healthcare Practitioner', row.name);
    // Deliberately omit contact, employment, user, patient and credential fields.
    console.log(JSON.stringify({
      practitioner_id: doctor.name,
      display_name: doctor.practitioner_name,
      status: doctor.status,
      qualification: doctor.sr_qualification,
      disease_fields_present: Object.hasOwn(doctor, 'sr_diseases'),
      diseases: (doctor.sr_diseases || []).map(d => d.disease),
      department: doctor.department,
      has_photo: Boolean(doctor.image),
      schedules: (doctor.practitioner_schedules || []).map(s => ({
        name: s.schedule, exists: scheduleNames.has(s.schedule), service_unit: s.service_unit,
      })),
    }));
  }
  for (const row of schedules) {
    const schedule = await erpGetDoc('Practitioner Schedule', row.name);
    console.log(JSON.stringify({
      schedule: schedule.name, disabled: schedule.disabled,
      time_slots: (schedule.time_slots || []).map(s => ({
        day: s.day, from_time: s.from_time, to_time: s.to_time,
        duration: s.duration, maximum_appointments: s.maximum_appointments,
      })),
    }));
  }
  console.log(`Verified ${practitioners.length} practitioner records and ${schedules.length} schedules on the target CRM.`);
}

main().catch(error => {
  console.error(error.status === 401
    ? 'Target CRM rejected the configured API credentials (HTTP 401). Update ERP_TOKEN or ERP_API_KEY/ERP_API_SECRET in .env. No localhost fallback was used.'
    : `Target verification failed${error.status ? ` (HTTP ${error.status})` : ''}. No records were changed.`);
  process.exitCode = 1;
});
