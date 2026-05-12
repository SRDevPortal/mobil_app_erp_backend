const express = require("express");
const crypto = require("crypto");
const { DOCTYPE } = require("../config");
const { erpCreate } = require("../frappeClient");
const { findMobileAppUser } = require("../services/userService");
const { mapWebhookEventToFrappe, pickExternalId } = require("../normalize");

const router = express.Router();

/**
 * Accepts n8n / Supabase-style payloads (filds.md §13). Resolves optional user from
 * customer_id, customer_email, user identifiers, or leaves user_id empty.
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const lookupBody = {
      ...body,
      external_id: body.user_external_id || body.customer_id || body.external_id,
      email: body.customer_email || body.email,
    };
    const user = await findMobileAppUser(lookupBody, {}, {});
    const userLink = user?.name || undefined;

    let external_id = pickExternalId(body);
    if (!external_id) external_id = crypto.randomUUID();

    const doc = mapWebhookEventToFrappe({ ...body, external_id }, userLink);
    const saved = await erpCreate(DOCTYPE.MOBILE_APP_WEBHOOK_EVENT, doc);
    return res.status(201).json({ success: true, data: saved });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
