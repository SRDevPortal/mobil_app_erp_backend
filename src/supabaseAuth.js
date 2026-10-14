const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = require("./config");

/**
 * Validates a Supabase session JWT via GET /auth/v1/user (same as your n8n HTTP Request).
 * @returns {Promise<object|null>} Supabase user JSON or null if invalid
 */
async function fetchSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const token = (accessToken || "").toString().trim();
  if (!token) return null;

  const base = SUPABASE_URL.replace(/\/auth\/v1\/user\/?$/, "").replace(/\/+$/, "");
  const url = `${base}/auth/v1/user`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) return null;
  return res.json();
}

function requireAccountDeletionConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error("Supabase account deletion is not configured"), { status: 503 });
  }
}

async function deleteSupabaseUser(userId) {
  requireAccountDeletionConfig();
  const base = SUPABASE_URL.replace(/\/auth\/v1\/user\/?$/, "").replace(/\/+$/, "");
  const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw Object.assign(new Error(`Supabase account deletion failed: ${text || res.status}`), {
      status: 502,
    });
  }
}

module.exports = { fetchSupabaseUser, deleteSupabaseUser, requireAccountDeletionConfig };
