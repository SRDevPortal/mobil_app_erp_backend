const express = require("express");
const { erpCallMethod, erpGetDoc } = require("../frappeClient");
const { DOCTYPE } = require("../config");
const { findMobileAppUser, tryUsersLookupV1, unwrapMobileAppV1Message } = require("../services/userService");
const {
  mergeHealthEntriesForToolSync,
  logsFromSyncBody,
  dedupeLogsById,
} = require("../services/healthEntryRows");
const { pickExternalId, pickPhone } = require("../normalize");
const {
  HEALTH_TOOL_KEYS,
  CANONICAL_MOTOR_NEURO_KEYS,
  isKnownHealthToolKey,
  normalizeHealthToolKey,
  frappeHealthEntryIdentity,
  useCanonicalFrappeMotorNeuroKeys,
} = require("../healthToolKeys");

const router = express.Router();

function stripRootUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Sync health tool logs on **Mobile App User** → **`health_entries`** child table
 * via Frappe **`mobile_app.api.v1.users_full_sync`**.
 *
 * **One ERP row per `tool_key`** — all logs for that tool are stored in `data_json` (JSON array).
 * The app sends the full list after each save/delete; this route updates that single row.
 *
 * Body (Flutter `BackendErpSync.syncHealthTool`):
 * - `external_id` / `customer_id` — Supabase user UUID
 * - `tool_key` — e.g. `bp_data`
 * - `data_json` — full log array for that tool (`[]` removes the tool row)
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const rawToolKey = body.tool_key != null ? String(body.tool_key).trim() : "";
    if (!rawToolKey) {
      return res.status(400).json({ success: false, message: "tool_key is required" });
    }
    if (!isKnownHealthToolKey(rawToolKey)) {
      return res.status(400).json({
        success: false,
        message: `Unknown tool_key: ${rawToolKey}`,
        allowed_tool_keys: [...HEALTH_TOOL_KEYS].sort(),
      });
    }
    const tool_key = normalizeHealthToolKey(rawToolKey);
    body.tool_key = tool_key;

    const userRow = await findMobileAppUser(body, {}, {});
    const parentExternalId =
      pickExternalId(body) || (userRow?.external_id != null ? String(userRow.external_id).trim() : "");
    if (!parentExternalId) {
      return res.status(400).json({
        success: false,
        message: "external_id (or customer_id / id) is required",
      });
    }

    const incomingLogs = logsFromSyncBody(body);
    if (body.data_json !== undefined && !Array.isArray(body.data_json) && incomingLogs.length === 0) {
      return res.status(400).json({
        success: false,
        message: "data_json must be an array of log objects (or omit for empty)",
      });
    }

    let existing = [];
    const v1 = await tryUsersLookupV1(body);
    if (Array.isArray(v1?.health_entries) && v1.health_entries.length) {
      existing = v1.health_entries.map((r) => ({ ...r }));
    } else if (userRow?.name) {
      try {
        const doc = await erpGetDoc(DOCTYPE.MOBILE_APP_USER, userRow.name);
        if (doc && Array.isArray(doc.health_entries)) {
          existing = doc.health_entries.map((r) => ({ ...r }));
        }
      } catch (_) {
        /* keep existing [] */
      }
    }

    const entriesCount = dedupeLogsById(incomingLogs).length;
    const syncPayload = () =>
      stripRootUndefined({
        external_id: parentExternalId,
        supabase_user_id:
          body.supabase_user_id != null
            ? String(body.supabase_user_id).trim()
            : parentExternalId,
        email: body.email != null ? String(body.email).trim() : undefined,
        phone: pickPhone(body) || undefined,
      });

    const callUsersFullSync = async (health_entries) =>
      erpCallMethod("mobile_app.api.v1.users_full_sync", {
        method: "POST",
        body: { ...syncPayload(), health_entries },
      });

    const isMotorNeuro = CANONICAL_MOTOR_NEURO_KEYS.has(tool_key);
    const tryCanonicalFirst = !isMotorNeuro || useCanonicalFrappeMotorNeuroKeys();
    const primaryCanonical = tryCanonicalFirst;
    const fallbackCanonical = !tryCanonicalFirst;

    let frappeIdentityUsed = frappeHealthEntryIdentity(tool_key, {
      useCanonical: primaryCanonical,
    });
    let next = mergeHealthEntriesForToolSync(existing, body, parentExternalId, {
      useCanonicalFrappeKeys: primaryCanonical,
    });

    let parsed;
    try {
      parsed = await callUsersFullSync(next);
    } catch (e) {
      const canRetryAlternate =
        isMotorNeuro && incomingLogs.length > 0;
      if (!canRetryAlternate) {
        const status = e.status >= 400 && e.status < 600 ? e.status : 502;
        return res.status(status).json({
          success: false,
          message: e.message || "users_full_sync failed",
          frappePath: e.frappePath,
          detail: e.payload,
        });
      }
      try {
        frappeIdentityUsed = frappeHealthEntryIdentity(tool_key, {
          useCanonical: fallbackCanonical,
        });
        next = mergeHealthEntriesForToolSync(existing, body, parentExternalId, {
          useCanonicalFrappeKeys: fallbackCanonical,
        });
        parsed = await callUsersFullSync(next);
      } catch (retryErr) {
        const status = retryErr.status >= 400 && retryErr.status < 600 ? retryErr.status : 502;
        return res.status(status).json({
          success: false,
          message: retryErr.message || "users_full_sync failed",
          frappePath: retryErr.frappePath,
          detail: retryErr.payload,
          canonical_tool_key: tool_key,
          frappe_tool_key_attempted: frappeIdentityUsed.tool_key,
        });
      }
    }

    const data = unwrapMobileAppV1Message(parsed);
    if (data && typeof data === "object") {
      return res.status(201).json({
        success: true,
        data: {
          ...data,
          tool_key,
          canonical_tool_key: tool_key,
          frappe_tool_key: frappeIdentityUsed.tool_key,
          health_entry_external_id: frappeIdentityUsed.health_entry_external_id,
          entries_count: entriesCount,
        },
      });
    }

    return res.status(502).json({
      success: false,
      message:
        "Frappe returned 200 but users_full_sync payload could not be parsed (expected message.success + message.data).",
      raw: parsed,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

module.exports = router;
