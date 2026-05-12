const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate } = require("../frappeClient");
const { findMobileAppUser } = require("./userService");
const { mapUserToFrappe, pickExternalId } = require("../normalize");

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
  if (!doc.full_name && doc.external_id) doc.full_name = doc.external_id;

  let saved;
  if (existing?.name) {
    saved = await erpUpdate(DOCTYPE.MOBILE_APP_USER, existing.name, doc);
  } else {
    saved = await erpCreate(DOCTYPE.MOBILE_APP_USER, doc);
  }

  return { saved, external_id };
}

module.exports = { upsertMobileAppUser };
