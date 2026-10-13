// Mobile-app profile metrics live in the app directory, not practitioner fields.
function mergeDoctorDirectoryMetrics(doctors, directory) {
  const profiles = new Map(directory.map(profile => [String(profile.id), profile]));
  return doctors.map(doctor => {
    const profile = profiles.get(String(doctor.id));
    if (!profile) return doctor;
    const number = key => {
      const value = profile[key];
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const rating = number('doctor_rating');
    return {
      ...doctor,
      rating: rating !== null && rating <= 5 ? rating : null,
      experience_years: number('experience_years'),
      opd_price: number('op_consulting_charge'),
      online_price: number('online_consulting_charge'),
    };
  });
}

module.exports = { mergeDoctorDirectoryMetrics };
