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
  "lft_reports_data",
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
  // Legacy keys (accepted on POST; normalized to canonical; merged on sync)
  "paralysis_motor_function",
  "paralysis_neuro_function",
  "paralysis_mobility_gait",
  "motor_log_data",
  "functional_log_data",
  "lab_reports_data",
]);

const CANONICAL_MOTOR_NEURO_KEYS = new Set(["motor_function", "neuro_function"]);

const LEGACY_TOOL_KEY_ALIASES = {
  paralysis_motor_function: "motor_function",
  paralysis_mobility_gait: "motor_function",
  paralysis_neuro_function: "neuro_function",
  motor_log_data: "motor_function",
  functional_log_data: "neuro_function",
  lab_reports_data: "lft_reports_data",
};

/** Old ERP rows to merge/remove when syncing canonical motor/neuro tools. */
const LEGACY_FRAPPE_ROW_IDENTITIES = {
  motor_function: [
    { tool_key: "paralysis_motor_function", health_entry_external_id: "health_paralysis_motor_function" },
    { tool_key: "paralysis_mobility_gait", health_entry_external_id: "health_paralysis_mobility_gait" },
    { tool_key: "motor_log_data", health_entry_external_id: "health_motor_log_data" },
  ],
  neuro_function: [
    { tool_key: "paralysis_neuro_function", health_entry_external_id: "health_paralysis_neuro_function" },
    { tool_key: "functional_log_data", health_entry_external_id: "health_functional_log_data" },
  ],
  lft_reports_data: [
    { tool_key: "lab_reports_data", health_entry_external_id: "health_lab_reports_data" },
  ],
};

function normalizeHealthToolKey(toolKey) {
  if (toolKey == null) return "";
  const key = String(toolKey).trim();
  return LEGACY_TOOL_KEY_ALIASES[key] ?? key;
}

/** Canonical Frappe child row identity (matches Mobile App Health Entry Select). */
function frappeHealthEntryIdentity(canonicalToolKey) {
  const canonical = normalizeHealthToolKey(canonicalToolKey);
  return {
    canonical_tool_key: canonical,
    tool_key: canonical,
    health_entry_external_id: `health_${canonical}`,
  };
}

/** Canonical + legacy ERP rows that belong to one app tool (for merge/dedupe). */
function frappeIdentitiesForCanonicalTool(canonicalToolKey) {
  const canonical = normalizeHealthToolKey(canonicalToolKey);
  const primary = frappeHealthEntryIdentity(canonical);
  const legacy = LEGACY_FRAPPE_ROW_IDENTITIES[canonical] || [];
  return [
    primary,
    ...legacy.map((row) => ({ canonical_tool_key: canonical, ...row })),
  ];
}

function isKnownHealthToolKey(toolKey) {
  if (toolKey == null) return false;
  return HEALTH_TOOL_KEYS.has(String(toolKey).trim());
}

module.exports = {
  HEALTH_TOOL_KEYS,
  CANONICAL_MOTOR_NEURO_KEYS,
  LEGACY_TOOL_KEY_ALIASES,
  LEGACY_FRAPPE_ROW_IDENTITIES,
  normalizeHealthToolKey,
  frappeHealthEntryIdentity,
  frappeIdentitiesForCanonicalTool,
  isKnownHealthToolKey,
};
