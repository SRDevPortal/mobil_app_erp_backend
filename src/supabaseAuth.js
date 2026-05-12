const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./config");

/**
 * Validates a Supabase session JWT via GET /auth/v1/user (same as your n8n HTTP Request).
 * @returns {Promise<object|null>} Supabase user JSON or null if invalid
 */
async function fetchSupabaseUser(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const token = (accessToken || "").toString().trim();
  if (!token) return null;

  const url = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`;
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

module.exports = { fetchSupabaseUser };
