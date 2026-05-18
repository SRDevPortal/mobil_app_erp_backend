const { frappeJsonField, toFrappeDatetime, nowFrappeDatetime } = require("../normalize");

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function parseJsonFieldValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function pickLogId(log, fallbackIndex) {
  const raw = log?.id ?? log?.entry_id;
  if (raw != null && String(raw).trim() !== "") return String(raw).trim();
  return `gen_${fallbackIndex}_${Date.now()}`;
}

/** One ERP child row per in-app log (`health_{tool_key}_{logId}`). */
function healthLogRowExternalId(toolKey, logId) {
  const tool = String(toolKey).trim();
  const id = String(logId).trim();
  return `health_${tool}_${id}`;
}

function isLegacySnapshotRow(row, toolKey) {
  const ext = row?.health_entry_external_id != null ? String(row.health_entry_external_id).trim() : "";
  if (ext === `health_${toolKey}`) return true;
  const parsed = parseJsonFieldValue(row?.data_json);
  return Array.isArray(parsed);
}

function logEntryTimestamp(log, fallbackIso) {
  const raw = log?.timestamp ?? log?.entry_timestamp ?? log?.logged_at;
  if (raw == null || raw === "") return fallbackIso;
  if (typeof raw === "number") {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return toFrappeDatetime(new Date(ms), fallbackIso);
  }
  return toFrappeDatetime(raw, fallbackIso);
}

/**
 * Single log → `health_entries` child row (`data_json` = one object, not an array).
 */
function mapSingleLogChildRow({
  toolKey,
  log,
  parentUserExternalId,
  source = "app",
  syncEntryId,
  index = 0,
}) {
  const tool_key = String(toolKey).trim();
  const logObj = log && typeof log === "object" ? { ...log } : {};
  const logId = pickLogId(logObj, index);
  const health_entry_external_id = healthLogRowExternalId(tool_key, logId);
  const fallbackTs = nowFrappeDatetime();

  const uid =
    parentUserExternalId != null && String(parentUserExternalId).trim() !== ""
      ? String(parentUserExternalId).trim()
      : undefined;

  return stripUndefined({
    health_entry_external_id,
    user_id: uid,
    tool_key: tool_key || undefined,
    entry_id: syncEntryId != null ? String(syncEntryId).trim() : logId,
    entry_timestamp: logEntryTimestamp(logObj, fallbackTs),
    data_json: frappeJsonField(logObj),
    source: source != null && String(source).trim() !== "" ? String(source).trim() : "app",
    is_deleted: logObj.is_deleted === true ? 1 : logObj.is_deleted === false ? 0 : undefined,
  });
}

/** Logs from POST body (`data_json` array or single object). */
function logsFromSyncBody(body = {}) {
  const payload = body.data_json !== undefined ? body.data_json : body.data;
  if (Array.isArray(payload)) {
    return payload.filter((x) => x != null && typeof x === "object");
  }
  if (payload && typeof payload === "object") {
    return [payload];
  }
  return [];
}

/** Build one child row per log for the tool in the sync request. */
function buildHealthEntryRowsForToolSync(body = {}, parentUserExternalId) {
  const tool_key = body.tool_key != null ? String(body.tool_key).trim() : "";
  if (!tool_key) return [];
  const logs = logsFromSyncBody(body);
  const source = body.source || "app";
  const syncEntryId = body.entry_id;
  return logs.map((log, i) =>
    mapSingleLogChildRow({
      toolKey: tool_key,
      log,
      parentUserExternalId,
      source,
      syncEntryId,
      index: i,
    }),
  );
}

/**
 * Expand legacy rows (`health_{tool}` + array in `data_json`) into per-log rows.
 */
function flattenHealthEntriesList(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    const tool = row.tool_key != null ? String(row.tool_key).trim() : "";
    const parsed = parseJsonFieldValue(row.data_json);

    if (tool && Array.isArray(parsed) && isLegacySnapshotRow(row, tool)) {
      parsed.forEach((log, i) => {
        if (!log || typeof log !== "object") return;
        out.push(
          mapSingleLogChildRow({
            toolKey: tool,
            log,
            parentUserExternalId: row.user_id,
            source: row.source || "app",
            index: i,
          }),
        );
      });
      continue;
    }

    out.push({ ...row });
  }
  return out;
}

/**
 * Replace all rows for `tool_key` with one row per log from the request body.
 */
function mergeHealthEntriesForToolSync(existingRows, body, parentUserExternalId) {
  const tool_key = body.tool_key != null ? String(body.tool_key).trim() : "";
  const flat = flattenHealthEntriesList(existingRows);
  const withoutTool = flat.filter((r) => String(r.tool_key || "").trim() !== tool_key);
  const newRows = buildHealthEntryRowsForToolSync(body, parentUserExternalId);
  return [...withoutTool, ...newRows];
}

module.exports = {
  parseJsonFieldValue,
  healthLogRowExternalId,
  logsFromSyncBody,
  buildHealthEntryRowsForToolSync,
  flattenHealthEntriesList,
  mergeHealthEntriesForToolSync,
  mapSingleLogChildRow,
};
