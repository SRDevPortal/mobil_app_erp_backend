const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate } = require("../frappeClient");
const { findMobileAppUser } = require("./userService");
const {
  mapUserToFrappe,
  mapUserProfileImagePatchToFrappe,
  pickExternalId,
} = require("../normalize");

/**
 * Create or update Mobile App User from a normalized payload (same shape as POST /api/v1/users/sync).
 * @returns {Promise<{ saved: object, external_id: string }>}
 */
async function upsertMobileAppUser(body = {}) {
  let external_id = pickExternalId(body);
  if (!external_id) {
    external_id = crypto.randomUUID();
  }

  const merged = { ...body, external_id };
  let existing =
    (await findMobileAppUser({ external_id }, {}, {})) ||
    (body.supabase_user_id ? await findMobileAppUser({ supabase_user_id: body.supabase_user_id }, {}, {}) : null) ||
    (body.email ? await findMobileAppUser({ email: body.email }, {}, {}) : null) ||
    (body.phone ? await findMobileAppUser({ phone: body.phone }, {}, {}) : null);

  const doc = mapUserToFrappe(merged);
  if (!doc.external_id) doc.external_id = external_id;
  // Only default display name for brand-new users (never overwrite on partial updates).
  if (!existing?.name && !doc.full_name && doc.external_id) {
    doc.full_name = doc.external_id;
  }

  let saved;
  if (existing?.name) {
    saved = await erpUpdate(DOCTYPE.MOBILE_APP_USER, existing.name, doc);
  } else {
    saved = await erpCreate(DOCTYPE.MOBILE_APP_USER, doc);
  }

  return { saved, external_id };
}

/**
 * After Frappe profile-image upload: patch only image URL fields on existing Mobile App User.
 * Does not change full_name, email, phone, or other identity fields.
 */
async function patchMobileAppUserProfileImage(body = {}) {
  const external_id = pickExternalId(body) || (body.supabase_user_id != null ? String(body.supabase_user_id).trim() : "");
  if (!external_id) {
    throw Object.assign(new Error("Provide supabase_user_id or external_id"), { status: 400 });
  }

  const existing =
    (await findMobileAppUser({ external_id }, {}, {})) ||
    (body.supabase_user_id ? await findMobileAppUser({ supabase_user_id: body.supabase_user_id }, {}, {}) : null);

  if (!existing?.name) {
    const err = new Error("Mobile App User not found for profile image patch");
    err.status = 404;
    throw err;
  }

  const doc = mapUserProfileImagePatchToFrappe(body);
  if (!doc.profile_image_url && !doc.avatar_url && !doc.image) {
    const err = new Error("No profile image fields to update");
    err.status = 400;
    throw err;
  }

  const saved = await erpUpdate(DOCTYPE.MOBILE_APP_USER, existing.name, doc);
  return { saved, external_id: existing.external_id || external_id };
}

module.exports = {
  upsertMobileAppUser,
  patchMobileAppUserProfileImage,
};
