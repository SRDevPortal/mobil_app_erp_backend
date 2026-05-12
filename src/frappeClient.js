const {
  ERP_BASE_URL,
  ERP_TOKEN,
  MOBILE_APP_ERP_TOKEN,
  erpAuthHeader,
  erpAuthHeaderMobileV1,
} = require("./config");

/**
 * @param {"resource"|"mobileV1"} auth - `resource` = Desk API `Authorization: token key:secret`;
 *   `mobileV1` = `mobile_app.api.v1.*` app token (`X-ERP-Token` + `Bearer` only).
 */
async function erpFetch(path, { method = "GET", body, query, auth = "resource" } = {}) {
  if (!ERP_BASE_URL) throw Object.assign(new Error("ERP_BASE_URL is not configured"), { status: 503 });

  const hasMobile = Boolean(MOBILE_APP_ERP_TOKEN || ERP_TOKEN);
  const hasResource = Boolean(ERP_TOKEN);
  if (auth === "mobileV1") {
    if (!hasMobile) {
      throw Object.assign(
        new Error(
          "ERP_TOKEN or MOBILE_APP_ERP_TOKEN must be set for mobile_app.api.v1 calls (match site_config mobile_app_erp_token)"
        ),
        { status: 503 }
      );
    }
  } else if (!hasResource) {
    throw Object.assign(new Error("ERP_TOKEN is not configured"), { status: 503 });
  }

  const url = new URL(`${ERP_BASE_URL}${path}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    }
  }

  const authHeaders = auth === "mobileV1" ? erpAuthHeaderMobileV1() : erpAuthHeader();

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
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
    let msg = parsed?.message || parsed?.exc || parsed?._error_message;
    if (!msg || String(msg).trim() === "") {
      msg = `ERP HTTP ${response.status} ${method} ${path}`;
      if (response.status === 404) {
        msg +=
          ". Unknown route or API method on Frappe (confirm mobile_app app is installed and migrated; method mobile_app.api.v1.users_full_sync exists). Ensure ERP_TOKEN matches site_config.json mobile_app_erp_token and try ERP_AUTH_SCHEME=bearer on Render.";
      }
    }
    const err = new Error(msg);
    err.status = response.status;
    err.payload = parsed;
    err.frappePath = path;
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
  return erpFetch(path, { method, query, body, auth: "mobileV1" });
}

module.exports = {
  erpFetch,
  erpGetList,
  erpCreate,
  erpUpdate,
  erpGetDoc,
  erpCallMethod,
};
