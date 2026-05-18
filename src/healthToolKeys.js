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

/** Canonical keys used by the Flutter app for new saves. */
const CANONICAL_MOTOR_NEURO_KEYS = new Set(["motor_function", "neuro_function"]);

const LEGACY_TOOL_KEY_ALIASES = {
  paralysis_motor_function: "motor_function",
  paralysis_mobility_gait: "motor_function",
  paralysis_neuro_function: "neuro_function",
  motor_log_data: "motor_function",
  functional_log_data: "neuro_function",
};

/**
 * Frappe `Mobile App Health Entry` row identity.
 * `tool_key` and `health_entry_external_id` must match what the DocType Select allows.
 * Set env `ERP_MOTOR_NEURO_CANONICAL_FRAPPE_KEYS=1` after adding motor_function / neuro_function on bench.
 */
const LEGACY_FRAPPE_HEALTH_ENTRY_IDENTITY = {
  motor_function: {
    tool_key: "paralysis_motor_function",
    health_entry_external_id: "health_paralysis_motor_function",
  },
  neuro_function: {
    tool_key: "paralysis_neuro_function",
    health_entry_external_id: "health_paralysis_neuro_function",
  },
};

function useCanonicalFrappeMotorNeuroKeys() {
  const v = process.env.ERP_MOTOR_NEURO_CANONICAL_FRAPPE_KEYS;
  return v === "1" || v === "true" || v === "yes";
}

function normalizeHealthToolKey(toolKey) {
  if (toolKey == null) return "";
  const key = String(toolKey).trim();
  return LEGACY_TOOL_KEY_ALIASES[key] ?? key;
}

/**
 * @param {string} canonicalToolKey - e.g. motor_function
 * @param {{ useCanonical?: boolean }} [options]
 * @returns {{ canonical_tool_key: string, tool_key: string, health_entry_external_id: string }}
 */
function frappeHealthEntryIdentity(canonicalToolKey, options = {}) {
  const canonical = normalizeHealthToolKey(canonicalToolKey);
  const preferCanonical =
    options.useCanonical === true ||
    (options.useCanonical !== false && useCanonicalFrappeMotorNeuroKeys());

  if (preferCanonical || !LEGACY_FRAPPE_HEALTH_ENTRY_IDENTITY[canonical]) {
    return {
      canonical_tool_key: canonical,
      tool_key: canonical,
      health_entry_external_id: `health_${canonical}`,
    };
  }

  const legacy = LEGACY_FRAPPE_HEALTH_ENTRY_IDENTITY[canonical];
  return {
    canonical_tool_key: canonical,
    tool_key: legacy.tool_key,
    health_entry_external_id: legacy.health_entry_external_id,
  };
}

/** All Frappe row shapes that map to one canonical app tool (for merge / dedupe). */
function frappeIdentitiesForCanonicalTool(canonicalToolKey) {
  const canonical = normalizeHealthToolKey(canonicalToolKey);
  const canonicalId = frappeHealthEntryIdentity(canonical, { useCanonical: true });
  const legacyId = frappeHealthEntryIdentity(canonical, { useCanonical: false });
  const out = [canonicalId];
  if (
    legacyId.tool_key !== canonicalId.tool_key ||
    legacyId.health_entry_external_id !== canonicalId.health_entry_external_id
  ) {
    out.push(legacyId);
  }
  return out;
}

function isKnownHealthToolKey(toolKey) {
  if (toolKey == null) return false;
  return HEALTH_TOOL_KEYS.has(String(toolKey).trim());
}

module.exports = {
  HEALTH_TOOL_KEYS,
  CANONICAL_MOTOR_NEURO_KEYS,
  LEGACY_TOOL_KEY_ALIASES,
  LEGACY_FRAPPE_HEALTH_ENTRY_IDENTITY,
  normalizeHealthToolKey,
  frappeHealthEntryIdentity,
  frappeIdentitiesForCanonicalTool,
  useCanonicalFrappeMotorNeuroKeys,
  isKnownHealthToolKey,
};
