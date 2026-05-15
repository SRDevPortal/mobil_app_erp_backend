const { DOCTYPE, ERP_BASE_URL, erpAuthHeader } = require("../config");
const { findMobileAppUser } = require("./userService");
const { patchMobileAppUserProfileImage } = require("./mobileAppUserSync");

function absoluteErpFileUrl(fileUrl) {
  const s = fileUrl != null ? String(fileUrl).trim() : "";
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    return s.replace(/:8000(?=\/|\?|#|$)/, "");
  }
  const base = (ERP_BASE_URL || "").replace(/\/+$/, "");
  if (!base) return s;
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${base}${path}`.replace(/:8000(?=\/|\?|#|$)/, "");
}

/**
 * Upload profile photo via Frappe `upload_file` on the Attach Image field only.
 * Does NOT call `mobile_app.api.profile_image.upload_profile_image` (that method overwrites full_name).
 */
async function uploadProfileImageOnly({
  supabaseUserId,
  externalId,
  fileBuffer,
  mimetype = "image/jpeg",
}) {
  const supabase_user_id = (supabaseUserId || "").toString().trim();
  const external_id = (externalId || supabase_user_id).toString().trim();
  if (!supabase_user_id) {
    throw Object.assign(new Error("Provide supabase_user_id"), { status: 400 });
  }
  if (!fileBuffer?.length) {
    throw Object.assign(new Error("Missing image file"), { status: 400 });
  }
  if (!ERP_BASE_URL) {
    throw Object.assign(new Error("ERP_BASE_URL is not configured"), { status: 503 });
  }

  const existing =
    (await findMobileAppUser({ supabase_user_id, external_id }, {}, {})) ||
    (await findMobileAppUser({ supabase_user_id }, {}, {}));
  if (!existing?.name) {
    throw Object.assign(new Error("Mobile App User not found"), { status: 404 });
  }

  const linkName = existing.name;
  const safeFilename = `profile-${Date.now()}.jpg`;

  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimetype }), safeFilename);
  form.append("doctype", DOCTYPE.MOBILE_APP_USER);
  form.append("docname", linkName);
  form.append("fieldname", "image");
  form.append("is_private", "0");

  const endpoint = `${ERP_BASE_URL.replace(/\/+$/, "")}/api/method/upload_file`;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: { ...erpAuthHeader() },
    body: form,
  });

  const raw = await upstream.text();
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch (_) {
    parsed = { message: raw };
  }

  if (!upstream.ok) {
    const err = new Error(
      parsed?.message || parsed?.exc || parsed?._error_message || `Frappe upload_file failed: ${upstream.status}`
    );
    err.status = upstream.status;
    err.payload = parsed;
    throw err;
  }

  const msg = parsed?.message || parsed || {};
  const fileUrl = (msg.file_url || "").toString().trim();
  const fileName = (msg.file_name || msg.name || "").toString().trim();
  const profile_image_url = absoluteErpFileUrl(fileUrl);
  const image = fileName || (fileUrl ? fileUrl.split("/").filter(Boolean).pop() : "");

  const { saved, external_id: resolvedExternal } = await patchMobileAppUserProfileImage({
    external_id,
    supabase_user_id,
    ...(profile_image_url ? { profile_image_url, avatar_url: profile_image_url } : {}),
    ...(image ? { image } : {}),
  });

  return {
    saved,
    external_id: resolvedExternal || external_id,
    profile_image_url: profile_image_url || saved?.profile_image_url || null,
    image: image || saved?.image || null,
  };
}

module.exports = { uploadProfileImageOnly, absoluteErpFileUrl };
