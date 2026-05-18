const { frappeJsonField, toFrappeDatetime, nowFrappeDatetime } = require("../normalize");
const {
  normalizeHealthToolKey,
  frappeHealthEntryIdentity,
  frappeIdentitiesForCanonicalTool,
} = require("../healthToolKeys");

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

/** One ERP child row per tool — all logs live in `data_json` array on that row. */
function pickToolSnapshotExternalId(toolKey) {
  return `health_${String(toolKey).trim()}`;
}

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

function dedupeLogsById(logs) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (!log || typeof log !== "object") continue;
    const id = pickLogId(log, i);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(log);
  }
  return out;
}

/** Incoming app payload wins over existing ERP logs with the same id. */
function mergeLogsPreferIncoming(existingLogs, incomingLogs) {
  const byId = new Map();
  for (let i = 0; i < existingLogs.length; i++) {
    const log = existingLogs[i];
    if (!log || typeof log !== "object") continue;
    byId.set(pickLogId(log, i), log);
  }
  for (let i = 0; i < incomingLogs.length; i++) {
    const log = incomingLogs[i];
    if (!log || typeof log !== "object") continue;
    byId.set(pickLogId(log, i), log);
  }
  return [...byId.values()];
}

function rowMatchesCanonicalTool(row, canonicalToolKey) {
  if (!row || typeof row !== "object") return false;
  const tool = normalizeHealthToolKey(String(canonicalToolKey).trim());
  const rowTool = normalizeHealthToolKey(String(row.tool_key || "").trim());
  if (rowTool === tool) return true;

  const ext = row.health_entry_external_id != null ? String(row.health_entry_external_id).trim() : "";
  for (const identity of frappeIdentitiesForCanonicalTool(tool)) {
    if (ext === identity.health_entry_external_id) return true;
    if (ext.startsWith(`${identity.health_entry_external_id}_`)) return true;
    if (ext.startsWith(`${pickToolSnapshotExternalId(tool)}_`)) return true;
  }
  return false;
}

function rowShouldRemoveForCanonicalToolSync(row, canonicalToolKey) {
  if (!row || typeof row !== "object") return false;
  const tool = normalizeHealthToolKey(String(canonicalToolKey).trim());
  const rowTool = String(row.tool_key || "").trim();
  const ext = row.health_entry_external_id != null ? String(row.health_entry_external_id).trim() : "";

  for (const identity of frappeIdentitiesForCanonicalTool(tool)) {
    if (rowTool === identity.tool_key) return true;
    if (ext === identity.health_entry_external_id) return true;
    if (ext.startsWith(`${identity.health_entry_external_id}_`)) return true;
  }
  if (normalizeHealthToolKey(rowTool) === tool) return true;
  if (ext === pickToolSnapshotExternalId(tool)) return true;
  if (ext.startsWith(`${pickToolSnapshotExternalId(tool)}_`)) return true;
  return false;
}

/** Read logs from any existing row for this tool (snapshot array or legacy per-log rows). */
function collectLogsFromExistingRows(existingRows, toolKey) {
  const tool = normalizeHealthToolKey(String(toolKey).trim());
  const snapshotId = pickToolSnapshotExternalId(tool);
  const logs = [];
  const seen = new Set();

  for (const row of existingRows || []) {
    if (!row || typeof row !== "object") continue;
    if (!rowMatchesCanonicalTool(row, tool)) continue;

    const ext = row.health_entry_external_id != null ? String(row.health_entry_external_id).trim() : "";
    const parsed = parseJsonFieldValue(row.data_json);

    if (Array.isArray(parsed)) {
      for (let i = 0; i < parsed.length; i++) {
        const log = parsed[i];
        if (!log || typeof log !== "object") continue;
        const id = pickLogId(log, i);
        if (seen.has(id)) continue;
        seen.add(id);
        logs.push(log);
      }
      continue;
    }

    if (parsed && typeof parsed === "object") {
      const id = pickLogId(parsed, logs.length);
      if (!seen.has(id)) {
        seen.add(id);
        logs.push(parsed);
      }
      continue;
    }

    if (ext && ext !== snapshotId) {
      /* empty data_json on a stray row — skip */
    }
  }

  return logs;
}

function mapToolSnapshotRow(body = {}, parentUserExternalId, logs) {
  const canonicalToolKey = normalizeHealthToolKey(
    body.tool_key != null ? String(body.tool_key).trim() : "",
  );
  const { tool_key, health_entry_external_id } = frappeHealthEntryIdentity(canonicalToolKey);
  const entry_timestamp = body.entry_timestamp
    ? toFrappeDatetime(body.entry_timestamp, nowFrappeDatetime())
    : nowFrappeDatetime();

  const uid =
    parentUserExternalId != null && String(parentUserExternalId).trim() !== ""
      ? String(parentUserExternalId).trim()
      : undefined;

  const deduped = dedupeLogsById(logs);

  return stripUndefined({
    health_entry_external_id,
    user_id: uid,
    tool_key: tool_key || undefined,
    entry_id: body.entry_id != null ? String(body.entry_id).trim() : undefined,
    entry_timestamp,
    data_json: frappeJsonField(deduped),
    score: body.score,
    source: body.source != null && String(body.source).trim() !== "" ? String(body.source).trim() : "app",
    is_deleted: body.is_deleted === true ? 1 : body.is_deleted === false ? 0 : body.is_deleted,
  });
}

/**
 * Keep one `health_entries` row per `tool_key`; store every log in `data_json` array.
 * Removes duplicate / per-log rows for the same tool from older syncs.
 */
function mergeHealthEntriesForToolSync(existingRows, body, parentUserExternalId) {
  const tool_key = normalizeHealthToolKey(
    body.tool_key != null ? String(body.tool_key).trim() : "",
  );
  body.tool_key = tool_key;

  const withoutTool = (existingRows || []).filter((r) => {
    if (!r || typeof r !== "object") return true;
    return !rowShouldRemoveForCanonicalToolSync(r, tool_key);
  });

  const incoming = dedupeLogsById(logsFromSyncBody(body));
  const existingLogs = collectLogsFromExistingRows(existingRows, tool_key);
  const mergedLogs = mergeLogsPreferIncoming(existingLogs, incoming);

  if (mergedLogs.length === 0) {
    return withoutTool;
  }

  return [...withoutTool, mapToolSnapshotRow(body, parentUserExternalId, mergedLogs)];
}

function buildHealthEntryRowsForToolSync(body, parentUserExternalId) {
  const row = mapToolSnapshotRow(body, parentUserExternalId, logsFromSyncBody(body));
  return row.health_entry_external_id ? [row] : [];
}

module.exports = {
  parseJsonFieldValue,
  pickToolSnapshotExternalId,
  logsFromSyncBody,
  dedupeLogsById,
  mergeLogsPreferIncoming,
  collectLogsFromExistingRows,
  mapToolSnapshotRow,
  rowShouldRemoveForCanonicalToolSync,
  buildHealthEntryRowsForToolSync,
  mergeHealthEntriesForToolSync,
};
