const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { DOCTYPE } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const {
  findMobileAppUser,
  getMobileAppUserForApi,
  getUserContextForApi,
  syncMobileAppUserViaV1,
} = require("../services/userService");
const { upsertMobileAppUser } = require("../services/mobileAppUserSync");
const { uploadProfileImageOnly } = require("../services/frappeProfileImageUpload");
const { pickSessionExternalId, mapSessionToFrappe, pickExternalId, attachCustomerIdentity } = require("../normalize");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.post("/sync", async (req, res) => {
  try {
    const body = req.body || {};
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

    const result = await uploadProfileImageOnly({
      supabaseUserId: supabase_user_id,
      externalId: external_id || supabase_user_id,
      fileBuffer: req.file.buffer,
      mimetype: req.file.mimetype || "image/jpeg",
    });

    return res.json({
      success: true,
      data: {
        ...attachCustomerIdentity(result.saved || {}, result.external_id || supabase_user_id),
        profile_image_url: result.profile_image_url,
        image: result.image,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
