const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const { DOCTYPE, ERP_BASE_URL, erpAuthHeader } = require("../config");
const { erpCreate, erpUpdate, erpGetList } = require("../frappeClient");
const { findMobileAppUser, enrichMobileAppUserForApi } = require("../services/userService");
const { upsertMobileAppUser } = require("../services/mobileAppUserSync");
const { pickSessionExternalId, mapSessionToFrappe, pickExternalId, attachCustomerIdentity } = require("../normalize");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.post("/sync", async (req, res) => {
  try {
    const { saved, external_id } = await upsertMobileAppUser(req.body || {});
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
    const user = await findMobileAppUser(req.query || {}, {}, {});
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const enriched = enrichMobileAppUserForApi(user);
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
    const user = await findMobileAppUser(req.query || {}, {}, {});
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const enrichedUser = enrichMobileAppUserForApi(user);
    const userLinkName = user.name;

    const profiles = await erpGetList(DOCTYPE.MOBILE_APP_USER_PROFILE, {
      filters: [["user_id", "=", userLinkName]],
      fields: [
        "name",
        "profile_name",
        "phone",
        "gender",
        "age",
        "height",
        "weight",
        "email",
        "profile_data_json",
        "modified",
      ],
      limit: 1,
      orderBy: "modified desc",
    });

    let diseases = await erpGetList(DOCTYPE.MOBILE_APP_USER_DISEASE_SELECTION, {
      filters: [
        ["user_id", "=", userLinkName],
        ["is_active", "=", 1],
      ],
      fields: ["name", "disease_name", "disease_id", "modified"],
      limit: 1,
      orderBy: "modified desc",
    });
    if (!diseases.length) {
      diseases = await erpGetList(DOCTYPE.MOBILE_APP_USER_DISEASE_SELECTION, {
        filters: [["user_id", "=", userLinkName]],
        fields: ["name", "disease_name", "disease_id", "modified"],
        limit: 1,
        orderBy: "modified desc",
      });
    }

    return res.json({
      success: true,
      data: {
        user: attachCustomerIdentity(enrichedUser, enrichedUser.external_id),
        profile: profiles[0] || null,
        disease_selection: diseases[0] || null,
      },
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
    if (!ERP_BASE_URL) {
      return res.status(503).json({ success: false, message: "ERP_BASE_URL is not configured" });
    }
    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({ success: false, message: "Missing file in form-data field 'file'" });
    }

    const body = req.body || {};
    const external_id = pickExternalId(body);
    const supabase_user_id = (body.supabase_user_id || body.supabaseUserId || external_id || "").toString().trim();
    if (!supabase_user_id) {
      return res.status(400).json({ success: false, message: "Provide supabase_user_id or external_id" });
    }

    const form = new FormData();
    form.append("supabase_user_id", supabase_user_id);
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "application/octet-stream" }),
      req.file.originalname || "profile-image.jpg"
    );

    const endpoint = `${ERP_BASE_URL.replace(/\/+$/, "")}/api/method/mobile_app.api.profile_image.upload_profile_image`;
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
      return res.status(upstream.status).json({
        success: false,
        message: parsed?.message || parsed?.exc || `Frappe upload failed: ${upstream.status}`,
        payload: parsed,
      });
    }

    const msg = parsed?.message || parsed?.data || parsed || {};
    const profile_image_url = (msg.profile_image_url || msg.image_url || msg.url || "").toString().trim();
    const image = (msg.image || "").toString().trim();

    const { saved, external_id: resolvedExternal } = await upsertMobileAppUser({
      external_id: external_id || supabase_user_id,
      supabase_user_id,
      ...(profile_image_url ? { profile_image_url, avatar_url: profile_image_url } : {}),
      ...(image ? { image } : {}),
    });

    return res.json({
      success: true,
      data: {
        ...attachCustomerIdentity(saved || {}, saved?.external_id || resolvedExternal || supabase_user_id),
        profile_image_url: profile_image_url || saved?.profile_image_url || null,
        image: image || saved?.image || null,
      },
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
