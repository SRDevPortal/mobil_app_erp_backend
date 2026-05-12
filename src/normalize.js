/**
 * Maps mobile / Supabase payloads (filds.md) to Frappe MobileApp DocType fields (erpmobileapp.md).
 */

function pickName(body) {
  const n =
    body.full_name ??
    body.fullname ??
    body.name ??
    body.profile_name;
  return n != null ? String(n).trim() : "";
}

function pickPhone(body) {
  const p =
    body.phone ??
    body.mobile ??
    body.phone_number ??
    body.phonenumber ??
    body.mobile_no ??
    body.mobileNo ??
    body.phoneNumber;
  return p != null ? String(p).trim() : "";
}

function pickGender(body) {
  const g = body.gender ?? body.sex;
  if (g == null || g === "") return "";
  const raw = String(g).trim();
  const s = raw.toLowerCase();
  if (s === "male" || s === "m") return "Male";
  if (s === "female" || s === "f") return "Female";
  return raw;
}

/**
 * Canonical unique customer id for Mobile App User → Frappe field **`external_id`**.
 * Aliases in JSON map to the same field (`customer_id`, `mobile_user_id`, etc.).
 */
function pickExternalId(body) {
  const id =
    body.external_id ??
    body.id ??
    body.customer_id ??
    body.mobile_user_id ??
    body.erp_customer_id;
  return id != null ? String(id).trim() : "";
}

/** Adds `customer_id` (same value) next to `external_id` on API responses for clarity. */
function attachCustomerIdentity(doc = {}, externalId) {
  const ext =
    externalId != null && String(externalId).trim() !== ""
      ? String(externalId).trim()
      : doc.external_id != null
        ? String(doc.external_id).trim()
        : "";
  if (!ext) return { ...doc };
  return { ...doc, external_id: ext, customer_id: ext };
}

/** Session row id (avoid conflating with user `id` on the same payload). */
function pickSessionExternalId(body) {
  const id = body.session_external_id ?? body.user_session_id ?? body.session_id;
  return id != null ? String(id).trim() : "";
}

/** ISO 8601 for JSON/API responses only — not for Frappe Datetime columns. */
function toIso(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

/**
 * Frappe Datetime → MySQL expects `YYYY-MM-DD HH:mm:ss`, not ISO `...T...Z`
 * (otherwise OperationalError 1292 Incorrect datetime value).
 */
function toFrappeDatetime(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function nowFrappeDatetime() {
  return toFrappeDatetime(new Date());
}

/**
 * DocType JSON / Long Text fields: Frappe may reject raw lists/objects from the REST API
 * ("Value for X cannot be a list"). Send a JSON string instead.
 */
function frappeJsonField(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return undefined;
  }
}

function mapUserToFrappe(body = {}) {
  const external_id = pickExternalId(body);
  const full_name = pickName(body) || external_id;
  const phone = pickPhone(body);
  const doc = {
    external_id: external_id || undefined,
    supabase_user_id: body.supabase_user_id != null ? String(body.supabase_user_id).trim() : undefined,
    email: body.email != null ? String(body.email).trim() : undefined,
    phone: phone || undefined,
    full_name: full_name || undefined,
    first_name: body.first_name,
    last_name: body.last_name,
    avatar_url: body.avatar_url,
    profile_image_url: body.profile_image_url,
    is_active: body.is_active === false ? 0 : body.is_active === true ? 1 : body.is_active,
    last_login_at: body.last_login_at ? toFrappeDatetime(body.last_login_at) : undefined,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

/** Row shape for `mobile_app.api.v1.users_full_sync` → **`profiles`** child table (not standalone DocType). */
function mapProfileChildRowForFullSync(row = {}) {
  const profile_name =
    row.profile_name != null ? String(row.profile_name).trim() : pickName(row) || undefined;
  const pc =
    row.profile_complete === true ? 1 : row.profile_complete === false ? 0 : row.profile_complete;
  const fs =
    row.force_profile_setup === true ? 1 : row.force_profile_setup === false ? 0 : row.force_profile_setup;
  const pdj = row.profile_data_json;
  const numOrUndef = (v) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return stripUndefined({
    profile_name: profile_name || undefined,
    phone: pickPhone(row) || undefined,
    gender: pickGender(row) || undefined,
    age: numOrUndef(row.age),
    height: numOrUndef(row.height),
    weight: numOrUndef(row.weight),
    email: row.email != null ? String(row.email).trim() : undefined,
    profile_complete: pc !== undefined && pc !== "" ? pc : undefined,
    force_profile_setup: fs !== undefined && fs !== "" ? fs : undefined,
    profile_data_json:
      pdj !== undefined ? (typeof pdj === "string" ? pdj : frappeJsonField(pdj)) : undefined,
    membership_type: row.membership_type,
    doctor_assigned: row.doctor_assigned,
    patient_id: row.patient_id,
  });
}

/** Builds `profiles` array for `users_full_sync` from either `{ profiles: [...] }` or legacy flat body. */
function buildProfilesPayloadForFullSync(body = {}) {
  const rows =
    Array.isArray(body.profiles) && body.profiles.length > 0 ? body.profiles : [body];
  return rows.map(mapProfileChildRowForFullSync);
}

function mapProfileToFrappe(body = {}, userLinkName) {
  const profile_name = body.profile_name != null ? String(body.profile_name).trim() : pickName(body);
  const doc = {
    user_id: userLinkName,
    profile_name: profile_name || undefined,
    phone: pickPhone(body) || undefined,
    gender: pickGender(body) || undefined,
    age: body.age,
    height: body.height,
    weight: body.weight,
    email: body.email != null ? String(body.email).trim() : undefined,
    membership_type: body.membership_type,
    doctor_assigned: body.doctor_assigned,
    patient_id: body.patient_id,
    profile_complete: body.profile_complete === true ? 1 : body.profile_complete === false ? 0 : body.profile_complete,
    force_profile_setup:
      body.force_profile_setup === true ? 1 : body.force_profile_setup === false ? 0 : body.force_profile_setup,
    profile_data_json: body.profile_data_json,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function pickDiseaseName(body) {
  const d =
    body.disease_name ??
    body.disease ??
    body.selected_disease ??
    body.selectedDisease ??
    body.medical_condition ??
    body.condition;
  return d != null ? String(d).trim() : "";
}

function mapDiseaseSelectionToFrappe(body = {}, userLinkName) {
  const external_id = pickExternalId(body) || undefined;
  const doc = {
    external_id,
    user_id: userLinkName,
    disease_id: body.disease_id != null ? String(body.disease_id).trim() : undefined,
    disease_name: pickDiseaseName(body) || undefined,
    is_active: body.is_active === false ? 0 : 1,
    selected_at: body.selected_at ? toFrappeDatetime(body.selected_at, nowFrappeDatetime()) : nowFrappeDatetime(),
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapHealthEntryToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    user_id: userLinkName,
    tool_key: body.tool_key != null ? String(body.tool_key).trim() : undefined,
    entry_id: body.entry_id,
    entry_timestamp: body.entry_timestamp ? toFrappeDatetime(body.entry_timestamp, nowFrappeDatetime()) : nowFrappeDatetime(),
    data_json: body.data_json ?? body.data ?? {},
    score: body.score,
    source: body.source || "app",
    is_deleted: body.is_deleted === true ? 1 : 0,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapSessionToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    user_id: userLinkName,
    supabase_access_token: body.supabase_access_token ?? body.supabaseAccessToken,
    supabase_refresh_token: body.supabase_refresh_token ?? body.supabaseRefreshToken,
    n8n_access_token: body.n8n_access_token,
    n8n_access_token_expires: body.n8n_access_token_expires
      ? toFrappeDatetime(body.n8n_access_token_expires)
      : undefined,
    has_explicitly_logged_out: body.has_explicitly_logged_out === true ? 1 : 0,
    device_info: body.device_info,
    ip_address: body.ip_address,
    user_agent: body.user_agent,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapPrescriptionToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    user_id: userLinkName,
    file_name: body.file_name,
    file_type: body.file_type,
    file_size: body.file_size,
    file_url: body.file_url,
    notes: body.notes,
    uploaded_at: body.uploaded_at ? toFrappeDatetime(body.uploaded_at, nowFrappeDatetime()) : nowFrappeDatetime(),
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapDoctorToFrappe(body = {}) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    doctor_name: body.doctor_name ?? body.name,
    specialty: body.specialty,
    tags: frappeJsonField(body.tags),
    image_url: body.image_url,
    is_active: body.is_active === false ? 0 : 1,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapAppointmentToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    booking_id: body.booking_id,
    user_id: userLinkName || undefined,
    patient_name: body.patient_name,
    patient_email: body.patient_email,
    patient_phone: body.patient_phone,
    appointment_for: body.appointment_for,
    appointment_type: body.appointment_type,
    appointment_date: body.appointment_date,
    appointment_time: body.appointment_time,
    scheduled_at: body.scheduled_at ? toFrappeDatetime(body.scheduled_at) : undefined,
    status: body.status || "pending",
    doctor_id: body.doctor_id,
    doctor_name: body.doctor_name,
    disease_name: body.disease_name,
    page_url: body.page_url,
    is_removed_by_user: body.is_removed_by_user === true ? 1 : 0,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapNotificationToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    user_id: userLinkName,
    title: body.title,
    body: body.body,
    notification_type: body.notification_type ?? body.type,
    additional_data: body.additional_data ?? {},
    is_read: body.is_read === true ? 1 : 0,
    received_at: body.received_at ? toFrappeDatetime(body.received_at, nowFrappeDatetime()) : nowFrappeDatetime(),
    clicked_at: body.clicked_at ? toFrappeDatetime(body.clicked_at) : undefined,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function toFrappeSelect(value, map) {
  if (value == null || value === "") return undefined;
  const key = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  return map[key] || value;
}

const SUPPORT_PRIORITY = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const SUPPORT_STATUS = {
  open: "Open",
  "in progress": "In Progress",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

function mapSupportTicketToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    user_id: userLinkName,
    requester_name: body.requester_name ?? body.name,
    email: body.email,
    phone: pickPhone(body) || body.phone,
    subject: body.subject,
    description: body.description,
    priority: toFrappeSelect(body.priority, SUPPORT_PRIORITY) || "Medium",
    status: toFrappeSelect(body.status, SUPPORT_STATUS) || "Open",
    attachments: frappeJsonField(body.attachments ?? []),
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapWebhookEventToFrappe(body = {}, userLinkName) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    user_id: userLinkName,
    event: body.event,
    tool: body.tool,
    request_payload: body.request_payload ?? body,
    response_payload: body.response_payload ?? {},
    status_code: body.status_code,
    success: body.success === true ? 1 : 0,
    error_message: body.error_message,
    created_at: body.created_at ? toFrappeDatetime(body.created_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function mapDiseaseMasterToFrappe(body = {}) {
  const doc = {
    external_id: pickExternalId(body) || undefined,
    disease_name: body.disease_name ?? body.name,
    handle: body.handle,
    page_url: body.page_url,
    is_active: body.is_active === false ? 0 : 1,
    sort_order: body.sort_order,
    created_at: body.created_at ? toFrappeDatetime(body.created_at) : undefined,
    updated_at: body.updated_at ? toFrappeDatetime(body.updated_at, nowFrappeDatetime()) : nowFrappeDatetime(),
  };
  return stripUndefined(doc);
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

module.exports = {
  pickExternalId,
  attachCustomerIdentity,
  pickSessionExternalId,
  pickName,
  pickPhone,
  pickGender,
  pickDiseaseName,
  toIso,
  toFrappeDatetime,
  nowFrappeDatetime,
  frappeJsonField,
  mapUserToFrappe,
  mapProfileToFrappe,
  mapProfileChildRowForFullSync,
  buildProfilesPayloadForFullSync,
  mapDiseaseSelectionToFrappe,
  mapHealthEntryToFrappe,
  mapSessionToFrappe,
  mapPrescriptionToFrappe,
  mapDoctorToFrappe,
  mapAppointmentToFrappe,
  mapNotificationToFrappe,
  mapSupportTicketToFrappe,
  mapWebhookEventToFrappe,
  mapDiseaseMasterToFrappe,
};
