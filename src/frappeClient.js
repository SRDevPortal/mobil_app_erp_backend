const { ERP_BASE_URL, ERP_TOKEN, erpAuthHeader } = require("./config");

async function erpFetch(path, { method = "GET", body, query } = {}) {
  if (!ERP_BASE_URL) throw Object.assign(new Error("ERP_BASE_URL is not configured"), { status: 503 });
  if (!ERP_TOKEN) throw Object.assign(new Error("ERP_TOKEN is not configured"), { status: 503 });

  const url = new URL(`${ERP_BASE_URL}${path}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    }
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...erpAuthHeader(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (_) {
    parsed = { message: text };
  }

  if (!response.ok) {
    const err = new Error(parsed?.message || parsed?.exc || `ERP call failed: ${response.status}`);
    err.status = response.status;
    err.payload = parsed;
    throw err;
  }

  return parsed;
}

async function erpGetList(doctype, { filters = [], fields = ["name"], limit = 20, orderBy = "modified desc" } = {}) {
  const payload = await erpFetch(`/api/resource/${encodeURIComponent(doctype)}`, {
    query: {
      filters,
      fields,
      order_by: orderBy,
      limit_page_length: limit,
    },
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function erpCreate(doctype, doc) {
  const payload = await erpFetch(`/api/resource/${encodeURIComponent(doctype)}`, {
    method: "POST",
    body: doc,
  });
  return payload?.data || null;
}

async function erpUpdate(doctype, name, doc) {
  const payload = await erpFetch(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: doc,
  });
  return payload?.data || null;
}

async function erpGetDoc(doctype, name) {
  const payload = await erpFetch(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
  return payload?.data || null;
}

/**
 * Call `mobile_app.api.*` whitelisted methods, e.g. `mobile_app.api.v1.users_lookup`.
 * Path: `/api/method/mobile_app.api.v1.users_lookup`
 */
async function erpCallMethod(methodDottedPath, { method = "GET", query = {}, body } = {}) {
  const clean = String(methodDottedPath || "").trim().replace(/^\/+/, "");
  if (!clean) throw Object.assign(new Error("erpCallMethod: missing method path"), { status: 400 });
  const path = `/api/method/${clean}`;
  return erpFetch(path, { method, query, body });
}

module.exports = {
  erpFetch,
  erpGetList,
  erpCreate,
  erpUpdate,
  erpGetDoc,
  erpCallMethod,
};
