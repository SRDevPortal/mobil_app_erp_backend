const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { uploadProfileImageToS3 } = require("../services/s3PrescriptionUpload");
const {
  findMobileAppUser,
  getMobileAppUserForApi,
  getUserContextForApi,
  syncMobileAppUserViaV1,
} = require("../services/userService");
const { upsertMobileAppUser } = require("../services/mobileAppUserSync");
const { pickSessionExternalId, mapSessionToFrappe, pickExternalId, attachCustomerIdentity } = require("../normalize");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

async function updateMobileAppUserImageFields(userName, profileImageUrl) {
  const updated_at = new Date().toISOString();
  const attempts = [
    { profile_image_url: profileImageUrl, avatar_url: profileImageUrl, image: profileImageUrl, updated_at },
    { profile_image_url: profileImageUrl, avatar_url: profileImageUrl, updated_at },
    { image: profileImageUrl, updated_at },
  ];
  let lastError = null;
  for (const doc of attempts) {
    try {
      return await erpUpdate(DOCTYPE.MOBILE_APP_USER, userName, doc);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Unable to update profile image fields");
}

router.post("/sync", async (req, res) => {
  try {
    const body = req.body || {};
    const existing = await getMobileAppUserForApi(body, {}, {});
    if (existing) {
      return res.json({
        success: true,
        data: attachCustomerIdentity(existing, existing.external_id ?? pickExternalId(body)),
      });
    }

    const fromV1 = await syncMobileAppUserViaV1(body);
    if (fromV1) {
      const ext = fromV1.external_id ?? pickExternalId(body);
      return res.json({
        success: true,
        data: attachCustomerIdentity(fromV1, ext),
      });
    }
    const { saved, external_id } = await upsertMobileAppUser(body);
    const ext = saved?.external_id ?? external_id;
    return res.json({
      success: true,
      data: attachCustomerIdentity(saved || {}, ext),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.get("/lookup", async (req, res) => {
  try {
    const enriched = await getMobileAppUserForApi(req.query || {}, {}, {});
    if (!enriched) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({
      success: true,
      data: attachCustomerIdentity(enriched, enriched.external_id),
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

/**
 * Full app bootstrap: Mobile App User + linked Profile + active disease selection (matched by supabase_user_id / external_id).
 */
router.get("/context", async (req, res) => {
  try {
    const data = await getUserContextForApi(req.query || {});
    if (!data?.user) return res.status(404).json({ success: false, message: "User not found" });
    return res.json({
      success: true,
      data,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/sessions/sync", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await findMobileAppUser(body, {}, {});
    if (!user?.name) return res.status(404).json({ success: false, message: "Mobile App User not found for session" });

    let sessionExternal = pickSessionExternalId(body);
    if (!sessionExternal) sessionExternal = crypto.randomUUID();

    const doc = mapSessionToFrappe({ ...body, external_id: sessionExternal }, user.name);

    const rows = await erpGetList(DOCTYPE.MOBILE_APP_USER_SESSION, {
      filters: [["external_id", "=", sessionExternal]],
      fields: ["name"],
      limit: 1,
    });
    const saved = rows[0]?.name
      ? await erpUpdate(DOCTYPE.MOBILE_APP_USER_SESSION, rows[0].name, doc)
      : await erpCreate(DOCTYPE.MOBILE_APP_USER_SESSION, doc);

    return res.json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.post("/profile-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({ success: false, message: "Missing file in form-data field 'file'" });
    }

    const body = req.body || {};
    const external_id = pickExternalId(body);
    const supabase_user_id = (body.supabase_user_id || body.supabaseUserId || external_id || "").toString().trim();
    if (!supabase_user_id) {
      return res.status(400).json({ success: false, message: "Provide supabase_user_id or external_id" });
    }

    const uploaded = await uploadProfileImageToS3({ file: req.file, userId: supabase_user_id });
    const profile_image_url = uploaded.url;

    let saved = null;
    let resolvedExternal = external_id || supabase_user_id;
    let persistWarning = null;
    try {
      const imageDoc = {
        profile_image_url,
        avatar_url: profile_image_url,
        image: profile_image_url,
        updated_at: new Date().toISOString(),
      };
      const existing = await findMobileAppUser(
        { external_id: resolvedExternal, supabase_user_id },
        {},
        {},
      );
      if (existing?.name) {
        saved = await updateMobileAppUserImageFields(existing.name, profile_image_url);
      } else {
        const result = await upsertMobileAppUser({
          external_id: resolvedExternal,
          supabase_user_id,
          ...imageDoc,
        });
        saved = result.saved;
        resolvedExternal = result.external_id || resolvedExternal;
      }
    } catch (e) {
      persistWarning = e.message || "Profile image uploaded, but ERP user record update failed.";
      console.warn("[users/profile-image] ERP user image URL update failed:", persistWarning);
    }

    return res.json({
      success: true,
      data: {
        ...attachCustomerIdentity(saved || {}, saved?.external_id || resolvedExternal || supabase_user_id),
        profile_image_url: profile_image_url || saved?.profile_image_url || null,
        avatar_url: profile_image_url || saved?.avatar_url || null,
        image: profile_image_url || saved?.image || null,
        upload_key: uploaded.key,
        ...(persistWarning ? { warning: persistWarning } : {}),
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
