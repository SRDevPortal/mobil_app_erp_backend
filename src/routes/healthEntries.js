const express = require("express");
const { erpCallMethod, erpGetDoc } = require("../frappeClient");
const { DOCTYPE } = require("../config");
const { findMobileAppUser, tryUsersLookupV1, unwrapMobileAppV1Message } = require("../services/userService");
const { mapHealthEntryChildRowForFullSync, pickExternalId, pickPhone } = require("../normalize");
const { HEALTH_TOOL_KEYS, isKnownHealthToolKey } = require("../healthToolKeys");

const router = express.Router();

function stripRootUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Upsert one health-tool snapshot on **Mobile App User** → **`health_entries`** child table
 * via Frappe **`mobile_app.api.v1.users_full_sync`** (not `/api/resource/Mobile App Health Entry`
 * when rows live only as child items).
 *
 * Body (Flutter `BackendErpSync.syncHealthTool`):
 * - `external_id` / `customer_id` — Supabase user UUID
 * - `tool_key` — e.g. `bp_data`, `vaginal_health_data`
 * - `entry_id` — client sync id (`local_{ms}_{hash}`)
 * - `entry_timestamp` — ISO 8601 UTC
 * - `data_json` — **full** log array for that tool after save
 * - `source` — `app` (default)
 */
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const tool_key = body.tool_key != null ? String(body.tool_key).trim() : "";
    if (!tool_key) {
      return res.status(400).json({ success: false, message: "tool_key is required" });
    }
    if (!isKnownHealthToolKey(tool_key)) {
      return res.status(400).json({
        success: false,
        message: `Unknown tool_key: ${tool_key}`,
        allowed_tool_keys: [...HEALTH_TOOL_KEYS].sort(),
      });
    }

    const userRow = await findMobileAppUser(body, {}, {});
    const parentExternalId =
      pickExternalId(body) || (userRow?.external_id != null ? String(userRow.external_id).trim() : "");
    if (!parentExternalId) {
      return res.status(400).json({
        success: false,
        message: "external_id (or customer_id / id) is required",
      });
    }

    const newRow = mapHealthEntryChildRowForFullSync(body, parentExternalId);
    if (!newRow?.health_entry_external_id) {
      return res.status(400).json({
        success: false,
        message: "health_entry_external_id could not be derived from tool_key",
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

    const extId = newRow.health_entry_external_id;
    const next = existing.filter((r) => {
      const rTool = r.tool_key != null ? String(r.tool_key).trim() : "";
      const rExt =
        r.health_entry_external_id != null ? String(r.health_entry_external_id).trim() : "";
      if (tool_key && rTool === tool_key) return false;
      if (extId && rExt === extId) return false;
      return true;
    });
    next.push(newRow);

    let parsed;
    try {
      parsed = await erpCallMethod("mobile_app.api.v1.users_full_sync", {
        method: "POST",
        body: stripRootUndefined({
          external_id: parentExternalId,
          supabase_user_id:
            body.supabase_user_id != null ? String(body.supabase_user_id).trim() : undefined,
          email: body.email != null ? String(body.email).trim() : undefined,
          phone: pickPhone(body) || undefined,
          health_entries: next,
        }),
      });
    } catch (e) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 502;
      return res.status(status).json({
        success: false,
        message: e.message || "users_full_sync failed",
        frappePath: e.frappePath,
        detail: e.payload,
      });
    }

    const data = unwrapMobileAppV1Message(parsed);
    if (data && typeof data === "object") {
      return res.status(201).json({
        success: true,
        data: {
          ...data,
          tool_key,
          health_entry_external_id: extId,
          entries_count: Array.isArray(body.data_json)
            ? body.data_json.length
            : Array.isArray(body.data)
              ? body.data.length
              : undefined,
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
