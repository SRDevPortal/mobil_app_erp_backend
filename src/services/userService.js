const { DOCTYPE } = require("../config");
const { erpGetList } = require("../frappeClient");
const { pickExternalId } = require("../normalize");

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
    fields: ["name", "external_id", "supabase_user_id", "email", "phone", "full_name", "modified"],
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
  resolveUserMiddleware,
  userLookupFilters,
};
