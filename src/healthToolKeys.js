/**
 * `tool_key` values accepted by POST /api/v1/health-entries.
 * Keep aligned with docs/DISEASE_HEALTH_TOOLS_FIELDS.md and the Flutter dashboard.
 */
const HEALTH_TOOL_KEYS = new Set([
  "bp_data",
  "sugar_data",
  "food_data",
  "prescriptions_data",
  "med_data",
  "gfr_data",
  "hba1c_data",
  "kft_reports_data",
  "cbc_reports_data",
  "liver_body_data",
  "urine_tracker_data",
  "lab_reports_data",
  "skin_daily_snapshot",
  "skin_symptoms_tracking",
  "skin_patch_tracking",
  "paralysis_motor_function",
  "paralysis_neuro_function",
  "diet_lifestyle_data",
  "exercise_support_data",
  "fertility_reports_data",
  "varicocele_data",
  "vaginal_health_data",
  "motor_log_data",
  "functional_log_data",
  "cancer_symptoms_tracker",
  "cancer_energy_recovery",
  "diabetes_health_data",
  "bowel_stool_data",
  "ibs_symptoms_data",
]);

function isKnownHealthToolKey(toolKey) {
  if (toolKey == null) return false;
  return HEALTH_TOOL_KEYS.has(String(toolKey).trim());
}

module.exports = { HEALTH_TOOL_KEYS, isKnownHealthToolKey };
