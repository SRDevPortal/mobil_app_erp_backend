const { DOCTYPE, ERP_BASE_URL } = require("../config");
const { erpGetList } = require("../frappeClient");
const { pickExternalId } = require("../normalize");

/** Turn relative `/files/...` paths into absolute URLs for the Flutter app. */
function absoluteErpAssetUrl(value) {
  const s = value != null ? String(value).trim() : "";
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  const base = (ERP_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return s;
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${base}${path}`;
}

/**
 * Adds `avatar_display_url` so clients can load the profile image after ERP-side uploads
 * (Attach Image `image`, or `profile_image_url` / `avatar_url`).
 */
function enrichMobileAppUserForApi(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const profile_image_url = doc.profile_image_url != null ? String(doc.profile_image_url).trim() : "";
  const avatar_url = doc.avatar_url != null ? String(doc.avatar_url).trim() : "";
  const image = doc.image != null ? String(doc.image).trim() : "";

  let avatar_display_url = "";
  if (/^https?:\/\//i.test(profile_image_url)) avatar_display_url = profile_image_url;
  else if (/^https?:\/\//i.test(avatar_url)) avatar_display_url = avatar_url;
  else if (profile_image_url) avatar_display_url = absoluteErpAssetUrl(profile_image_url);
  else if (avatar_url) avatar_display_url = absoluteErpAssetUrl(avatar_url);
  else if (image) {
    const path = image.includes("/") ? image : `/files/${image}`;
    avatar_display_url = absoluteErpAssetUrl(path);
  }

  return { ...doc, avatar_display_url };
}

function userLookupFilters(body = {}, params = {}, query = {}) {
  const merged = { ...query, ...params, ...body };
  const external_id = pickExternalId(merged);
  const supabase_user_id =
    merged.supabase_user_id != null ? String(merged.supabase_user_id).trim() : "";
  const email = merged.email != null ? String(merged.email).trim() : "";
  const phone = merged.phone != null ? String(merged.phone).trim() : "";

  if (external_id) return [["external_id", "=", external_id]];
  if (supabase_user_id) return [["supabase_user_id", "=", supabase_user_id]];
  if (email) return [["email", "=", email]];
  if (phone) return [["phone", "=", phone]];
  return null;
}

async function findMobileAppUser(body = {}, params = {}, query = {}) {
  const filters = userLookupFilters(body, params, query);
  if (!filters) return null;
  const rows = await erpGetList(DOCTYPE.MOBILE_APP_USER, {
    filters,
    fields: [
      "name",
      "external_id",
      "supabase_user_id",
      "email",
      "phone",
      "full_name",
      "modified",
      "avatar_url",
      "profile_image_url",
      "image",
    ],
    limit: 1,
  });
  return rows[0] || null;
}

/**
 * Resolves Frappe Link target for Mobile App User (`name`, usually equals `external_id`).
 */
async function resolveUserMiddleware(req, res, next) {
  try {
    const user = await findMobileAppUser(req.body || {}, req.params || {}, req.query || {});
    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "Mobile App User not found. Provide external_id, id, customer_id, supabase_user_id, email, or phone.",
      });
    }
    req.mobileUser = user;
    req.userLinkName = user.name;
    return next();
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
}

module.exports = {
  findMobileAppUser,
  enrichMobileAppUserForApi,
  resolveUserMiddleware,
  userLookupFilters,
};
