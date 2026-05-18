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
  "motor_function",
  "neuro_function",
  "diet_lifestyle_data",
  "exercise_support_data",
  "fertility_reports_data",
  "varicocele_data",
  "vaginal_health_data",
  "cancer_symptoms_tracker",
  "cancer_energy_recovery",
  "diabetes_health_data",
  "bowel_stool_data",
  "ibs_symptoms_data",
  // Legacy keys (still accepted for existing ERP rows; app normalizes on read)
  "paralysis_motor_function",
  "paralysis_neuro_function",
  "paralysis_mobility_gait",
  "motor_log_data",
  "functional_log_data",
]);

/** Canonical keys written for new saves from the app. */
const CANONICAL_MOTOR_NEURO_KEYS = new Set(["motor_function", "neuro_function"]);

const LEGACY_TOOL_KEY_ALIASES = {
  paralysis_motor_function: "motor_function",
  paralysis_mobility_gait: "motor_function",
  paralysis_neuro_function: "neuro_function",
  motor_log_data: "motor_function",
  functional_log_data: "neuro_function",
};

function normalizeHealthToolKey(toolKey) {
  if (toolKey == null) return "";
  const key = String(toolKey).trim();
  return LEGACY_TOOL_KEY_ALIASES[key] ?? key;
}

function isKnownHealthToolKey(toolKey) {
  if (toolKey == null) return false;
  return HEALTH_TOOL_KEYS.has(String(toolKey).trim());
}

module.exports = {
  HEALTH_TOOL_KEYS,
  CANONICAL_MOTOR_NEURO_KEYS,
  LEGACY_TOOL_KEY_ALIASES,
  normalizeHealthToolKey,
  isKnownHealthToolKey,
};
