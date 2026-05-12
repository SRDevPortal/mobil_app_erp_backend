# backend-erp — HTTP API reference (Postman / curl)

**Base URL (default):** `http://localhost:3101`  
Set `PORT` in `.env` if you use another port.

**Tunnel (ngrok):** If you expose this service with ngrok, use your public host as `base_url` in Postman (example: `https://diabetic-crux-unnatural.ngrok-free.dev` → same paths as local). See `POSTMAN.md` → *Using ngrok* and `postman/SRIAAS-backend-erp.postman_environment.ngrok.json`. For **curl** or tools without the Postman collection script, add header `ngrok-skip-browser-warning: true` so ngrok free does not return the HTML warning page.

---

## Scope — is this the full API (A–Z)?

**Yes, for this service.** Every HTTP route registered in `src/app.js` and `src/routes/*.js` is documented in this file. There are exactly **16** endpoints:

| # | Kind | Count |
|---|------|------:|
| 1 | Public (no app token) | 2 |
| 2 | Protected (`APP_ERP_TOKEN` required) | 14 |

There is **no** `/api/v2`, **no** WebSocket/Socket.IO, **no** GraphQL, and **no** extra files under `backend-erp` that expose other HTTP routes.

### A–Z index (by path)

| Method | Path |
|--------|------|
| `GET` | `/api/health` |
| `POST` | `/api/auth/verify-supabase` |
| `POST` | `/api/v1/appointments` |
| `POST` | `/api/v1/disease-selections` |
| `POST` | `/api/v1/diseases/sync` |
| `POST` | `/api/v1/doctors/sync` |
| `POST` | `/api/v1/health-entries` |
| `POST` | `/api/v1/notifications` |
| `POST` | `/api/v1/prescriptions` |
| `POST` | `/api/v1/profiles/sync` |
| `POST` | `/api/v1/support-tickets` |
| `GET` | `/api/v1/users/lookup` |
| `POST` | `/api/v1/users/sessions/sync` |
| `POST` | `/api/v1/users/profile-image` |
| `POST` | `/api/v1/users/sync` |
| `POST` | `/api/v1/webhook-events` |

### Not implemented (nothing “missing” in code — these features do not exist yet)

If you need any of the following, they must be **added in code** first; they are **not** hidden elsewhere:

- `GET` list / pagination for health entries, notifications, tickets, etc.
- `PUT` / `PATCH` / `DELETE` for arbitrary DocTypes
- File upload multipart routes (this API only forwards JSON metadata to Frappe)
- OAuth for third-party providers — Supabase sessions are validated separately via **`POST /api/auth/verify-supabase`** (no `APP_ERP_TOKEN`; requires server `SUPABASE_*` env vars)

### Unknown URL behavior

Calling any path **not** in the table above (for example `GET /api/v1/users`) hits Express’s default **404**: plain text such as `Cannot GET /api/v1/users`, **not** `{ "success": false, "message": "..." }`.  
The JSON error shape applies to **handled** routes and the global **500** error middleware when an error is passed to it.

### Technical defaults (this backend)

- **CORS:** enabled for all origins (`cors()` with no allowlist).
- **JSON body limit:** `2mb` for `express.json`.
- **Frappe errors:** failed upstream calls may return **4xx/5xx** with `success: false` and Frappe’s message in `message` (status depends on Frappe).

---

## Auth model (two secrets)

| Direction | Env var | How it’s sent |
|-----------|---------|----------------|
| **App / Postman → this Node API** | **`APP_ERP_TOKEN`** | Header **`X-ERP-Token`** or **`Authorization: Bearer`** (see § Authentication below). |
| **This Node API → Frappe** | **`ERP_TOKEN`** | **`Authorization: token <client_id>:<client_secret>`** (Frappe User API key). Optional **`ERP_AUTH_SCHEME=bearer`** for **`Bearer`** instead. |

All outbound Frappe calls (`/api/resource/...`, `/api/method/mobile_app.api.v1.*`) use **only** **`ERP_TOKEN`** — no separate mobile-app env vars.

| This backend route | Frappe upstream (typical) |
|--------------------|---------------------------|
| `GET /api/v1/users/lookup`, `POST …/users/sync` | `mobile_app.api.v1.users_lookup` / `users_sync` |
| `POST /api/v1/profiles/sync` | `mobile_app.api.v1.users_full_sync` |
| Other DocType routes | `/api/resource/<DocType>/…` |

Configure **`ERP_BASE_URL`** and **`ERP_TOKEN`** so Postman-to-Frappe using the same key works when debugging.

---

## Authentication

- **`GET /api/health`** — no token.
- **`POST /api/auth/verify-supabase`** — no `APP_ERP_TOKEN`. Send only the user’s **Supabase access token** in JSON (same validation flow as n8n calling `GET .../auth/v1/user`). Server must set **`SUPABASE_URL`** and **`SUPABASE_ANON_KEY`**. On success, upserts **Mobile App User** with **`external_id` = Supabase user UUID** (the stable key used across DocTypes). Optional JSON **`phone`** fills `phone` when Supabase does not return it yet (email-OTP-only flows).
- **All `/api/v1/*` routes** — send your `APP_ERP_TOKEN` using **one** of:
  - Header: `X-ERP-Token: <APP_ERP_TOKEN>`
  - Header: `Authorization: Bearer <APP_ERP_TOKEN>`

Replace `YOUR_APP_TOKEN` in the curl examples below.

### `POST /api/auth/verify-supabase` (public)

**Body (JSON):**

| Field | Required | Notes |
|--------|----------|--------|
| `supabaseAccessToken` | Yes | Current Supabase session access JWT (alias: `supabase_access_token`, `access_token`) |
| `phone` | No | Normalized into Mobile App User **`phone`** if missing from Supabase user / metadata |

**200 response:** `data` includes **`external_id`** (canonical unique customer id in Frappe) and **`customer_id`** (same value). Also `supabase_user_id`, `mobile_app_user_name`, `email`, `phone`, `full_name`.

**401:** Invalid or expired Supabase session.

**503:** `SUPABASE_URL` / `SUPABASE_ANON_KEY` not set on the server.

---

## HTTP status codes (typical)

| Code | Meaning |
|------|--------|
| **200** | OK (`users/sync`, `users/sessions/sync`, `profiles/sync`, `diseases/sync`, `doctors/sync`, `appointments` when updating by `booking_id`) |
| **201** | Created (`disease-selections`, `health-entries`, `prescriptions`, `appointments` on first create, `notifications`, `support-tickets`, `webhook-events`) |
| **400** | Bad request (e.g. `health-entries` without `tool_key`) |
| **401** | Missing or invalid app token |
| **404** | User not found (lookup, or routes that require an existing **Mobile App User**) |
| **500** | Server or Frappe error |
| **503** | `APP_ERP_TOKEN` not configured on server, or Frappe URL/token not configured |

### Success body shape

```json
{
  "success": true,
  "data": { }
}
```

`data` is the Frappe document returned after save (field names match your DocTypes). `name` is the Frappe document id.

**Customer identity:** **Mobile App User** stores the unique app customer id in **`external_id`** (same UUID as Supabase `auth.users.id`). Responses from **`POST /api/v1/users/sync`**, **`GET /api/v1/users/lookup`**, and **`POST /api/auth/verify-supabase`** also include **`customer_id`** (= `external_id`). Incoming JSON may use **`customer_id`**, **`mobile_user_id`**, or **`erp_customer_id`** wherever **`external_id`** is accepted.

### Error body shape

```json
{
  "success": false,
  "message": "Error description"
}
```

---

## Endpoint list (same as A–Z index; includes auth)

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | No |
| POST | `/api/v1/appointments` | Yes |
| POST | `/api/v1/disease-selections` | Yes |
| POST | `/api/v1/diseases/sync` | Yes |
| POST | `/api/v1/doctors/sync` | Yes |
| POST | `/api/v1/health-entries` | Yes |
| POST | `/api/v1/notifications` | Yes |
| POST | `/api/v1/prescriptions` | Yes |
| POST | `/api/v1/profiles/sync` | Yes |
| POST | `/api/v1/support-tickets` | Yes |
| GET | `/api/v1/users/lookup` | Yes |
| POST | `/api/v1/users/sessions/sync` | Yes |
| POST | `/api/v1/users/sync` | Yes |
| POST | `/api/v1/webhook-events` | Yes |

---

## 1) Health

**`GET /api/health`** → **200**

```bash
curl -sS "http://localhost:3101/api/health"
```

**Example 200 response:**

```json
{
  "success": true,
  "service": "sriaas-backend-erp",
  "frappe": {
    "baseUrlConfigured": true,
    "erpTokenConfigured": true,
    "appTokenConfigured": true,
    "doctypes": {
      "MOBILE_APP_USER": "Mobile App User",
      "MOBILE_APP_USER_SESSION": "Mobile App User Session",
      "MOBILE_APP_USER_PROFILE": "Mobile App User Profile",
      "MOBILE_APP_DISEASE": "Mobile App Disease",
      "MOBILE_APP_USER_DISEASE_SELECTION": "Mobile App User Disease Selection",
      "MOBILE_APP_HEALTH_ENTRY": "Mobile App Health Entry",
      "MOBILE_APP_PRESCRIPTION": "Mobile App Prescription",
      "MOBILE_APP_DOCTOR": "Mobile App Doctor",
      "MOBILE_APP_APPOINTMENT": "Mobile App Appointment",
      "MOBILE_APP_NOTIFICATION": "Mobile App Notification",
      "MOBILE_APP_SUPPORT_TICKET": "Mobile App Support Ticket",
      "MOBILE_APP_WEBHOOK_EVENT": "Mobile App Webhook Event"
    }
  }
}
```

---

## 2) Upsert Mobile App User

**`POST /api/v1/users/sync`** → **200** (or **500** if Frappe rejects)

```bash
curl -sS -X POST "http://localhost:3101/api/v1/users/sync" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"supabase_user_id\":\"sub_abc123\",\"email\":\"patient@example.com\",\"phone\":\"+919876543210\",\"full_name\":\"Test Patient\",\"first_name\":\"Test\",\"last_name\":\"Patient\",\"is_active\":true}"
```

**Example 200 response:**

```json
{
  "success": true,
  "data": {
    "name": "550e8400-e29b-41d4-a716-446655440000",
    "external_id": "550e8400-e29b-41d4-a716-446655440000",
    "supabase_user_id": "sub_abc123",
    "email": "patient@example.com",
    "phone": "+919876543210",
    "full_name": "Test Patient",
    "first_name": "Test",
    "last_name": "Patient",
    "is_active": 1,
    "modified": "2026-05-12 10:15:00.000000"
  }
}
```

---

## 3) Lookup Mobile App User

**`GET /api/v1/users/lookup`** → **200** or **404**

Query params (use at least one): `external_id`, `id`, `customer_id`, `supabase_user_id`, `email`, `phone`.

```bash
curl -sS "http://localhost:3101/api/v1/users/lookup?external_id=550e8400-e29b-41d4-a716-446655440000" \
  -H "X-ERP-Token: YOUR_APP_TOKEN"
```

**Example 200 response:**

```json
{
  "success": true,
  "data": {
    "name": "550e8400-e29b-41d4-a716-446655440000",
    "external_id": "550e8400-e29b-41d4-a716-446655440000",
    "supabase_user_id": "sub_abc123",
    "email": "patient@example.com",
    "phone": "+919876543210",
    "full_name": "Test Patient",
    "modified": "2026-05-12 10:15:00.000000"
  }
}
```

**Example 404 response:**

```json
{
  "success": false,
  "message": "User not found"
}
```

---

## 4) Upsert Mobile App User Session

**`POST /api/v1/users/sessions/sync`** → **200** or **404**

Resolve the user with the same identifiers as lookup (`external_id`, `id`, `customer_id`, `supabase_user_id`, `email`, `phone`).

For the **session row** id, use `session_external_id`, `user_session_id`, or `session_id` (do not rely on user `id` alone for the session document).

```bash
curl -sS -X POST "http://localhost:3101/api/v1/users/sessions/sync" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"session_external_id\":\"11111111-2222-3333-4444-555555555555\",\"device_info\":{\"platform\":\"android\"},\"ip_address\":\"203.0.113.1\"}"
```

**Example 200 response:**

```json
{
  "success": true,
  "data": {
    "name": "11111111-2222-3333-4444-555555555555",
    "external_id": "11111111-2222-3333-4444-555555555555",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "device_info": { "platform": "android" },
    "ip_address": "203.0.113.1",
    "modified": "2026-05-12 10:20:00.000000"
  }
}
```

**Example 404 response:**

```json
{
  "success": false,
  "message": "Mobile App User not found for session"
}
```

---

## 5) Upsert Mobile App User Profile (child table `profiles`)

**`POST /api/v1/profiles/sync`** → **200** or **404**

Proxies to Frappe **`mobile_app.api.v1.users_full_sync`** with a **`profiles`** array (replaces child rows for that table when present — see `api-list-erp.md`).

**Required:** **`external_id`** (same UUID as Supabase user).

**Preferred body** — array of profile row(s), matching desk **Profiles** tab:

```bash
curl -sS -X POST "http://localhost:3101/api/v1/profiles/sync" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"17a2f5c0-ab69-419c-aed6-43c7e2eedfb0\",\"profiles\":[{\"profile_name\":\"Primary\",\"phone\":\"9466073244\",\"email\":\"you@example.com\",\"gender\":\"Male\",\"age\":35,\"height\":170,\"weight\":72,\"profile_complete\":1,\"force_profile_setup\":0,\"profile_data_json\":{}}]}"
```

**Backward compatible:** the same fields may be sent **flat** on the root object (no `profiles` key); the server wraps them as a single row.

**Example 200 response:** `data` is the Frappe **`users_full_sync`** payload (full **Mobile App User** document shape, including **`profiles`**, plus **`profile_image_url`** when the app adds it).

```json
{
  "success": true,
  "data": {
    "external_id": "17a2f5c0-ab69-419c-aed6-43c7e2eedfb0",
    "profiles": [
      {
        "profile_name": "Primary",
        "phone": "9466073244",
        "gender": "Male",
        "age": 35,
        "height": 170,
        "weight": 72,
        "profile_complete": 1,
        "force_profile_setup": 0
      }
    ]
  }
}
```

**Note:** There is **no** Resource API fallback for profile rows. Many sites only store profiles as the **`profiles`** child table on **Mobile App User**; calling **`/api/resource/Mobile App User Profile`** then returns **404**. Fix Frappe **`users_full_sync`** / token instead.

---

## 6) Upsert Mobile App Disease (master)

**`POST /api/v1/diseases/sync`** → **200**

```bash
curl -sS -X POST "http://localhost:3101/api/v1/diseases/sync" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"disease-uuid-001\",\"disease_name\":\"Diabetes\",\"handle\":\"diabetes\",\"is_active\":true,\"sort_order\":1}"
```

**Example 200 response:**

```json
{
  "success": true,
  "data": {
    "name": "disease-uuid-001",
    "external_id": "disease-uuid-001",
    "disease_name": "Diabetes",
    "handle": "diabetes",
    "is_active": 1,
    "sort_order": 1,
    "modified": "2026-05-12 10:25:00.000000"
  }
}
```

---

## 7) Create Mobile App User Disease Selection

**`POST /api/v1/disease-selections`** → **201** or **404**

`disease_id` must be the Frappe **name** of a **Mobile App Disease** row (often equals `external_id` if autoname is `field:external_id`).

```bash
curl -sS -X POST "http://localhost:3101/api/v1/disease-selections" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"disease_id\":\"disease-uuid-001\",\"disease_name\":\"Diabetes\",\"is_active\":true}"
```

**Example 201 response:**

```json
{
  "success": true,
  "data": {
    "name": "sel-uuid-here",
    "external_id": "sel-uuid-here",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "disease_id": "disease-uuid-001",
    "disease_name": "Diabetes",
    "is_active": 1,
    "modified": "2026-05-12 10:26:00.000000"
  }
}
```

---

## 8) Create Mobile App Health Entry

**`POST /api/v1/health-entries`** → **201**, **400**, or **404**

`tool_key` is required.

```bash
curl -sS -X POST "http://localhost:3101/api/v1/health-entries" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"tool_key\":\"bp_data\",\"entry_id\":\"local-entry-1\",\"entry_timestamp\":\"2026-05-12T08:00:00.000Z\",\"data_json\":{\"systolic\":120,\"diastolic\":80},\"source\":\"app\"}"
```

**Example 201 response:**

```json
{
  "success": true,
  "data": {
    "name": "entry-uuid-here",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "tool_key": "bp_data",
    "entry_timestamp": "2026-05-12 08:00:00.000000",
    "data_json": { "systolic": 120, "diastolic": 80 },
    "source": "app",
    "modified": "2026-05-12 10:30:00.000000"
  }
}
```

**Example 400 response:**

```json
{
  "success": false,
  "message": "tool_key is required"
}
```

---

## 9) Create Mobile App Prescription

**`POST /api/v1/prescriptions`** → **201** or **404**

```bash
curl -sS -X POST "http://localhost:3101/api/v1/prescriptions" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"file_name\":\"rx.pdf\",\"file_type\":\"application/pdf\",\"file_size\":245678,\"file_url\":\"https://storage.example.com/rx.pdf\",\"notes\":\"Follow-up dose\"}"
```

**Example 201 response:**

```json
{
  "success": true,
  "data": {
    "name": "rx-doc-name",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "file_name": "rx.pdf",
    "file_type": "application/pdf",
    "file_size": 245678,
    "file_url": "https://storage.example.com/rx.pdf",
    "modified": "2026-05-12 10:32:00.000000"
  }
}
```

---

## 10) Upsert Mobile App Doctor

**`POST /api/v1/doctors/sync`** → **200**

```bash
curl -sS -X POST "http://localhost:3101/api/v1/doctors/sync" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"doc-001\",\"doctor_name\":\"Dr. Example\",\"specialty\":\"Nephrology\",\"tags\":[\"diabetes\"],\"is_active\":true}"
```

**Example 200 response:**

```json
{
  "success": true,
  "data": {
    "name": "doc-001",
    "external_id": "doc-001",
    "doctor_name": "Dr. Example",
    "specialty": "Nephrology",
    "tags": ["diabetes"],
    "is_active": 1,
    "modified": "2026-05-12 10:35:00.000000"
  }
}
```

---

## 11) Create or update Mobile App Appointment

**`POST /api/v1/appointments`** → **201** (create) or **200** (update when `booking_id` already exists)

```bash
curl -sS -X POST "http://localhost:3101/api/v1/appointments" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"booking_id\":\"BK-2026-00001\",\"patient_name\":\"Test Patient\",\"patient_email\":\"patient@example.com\",\"patient_phone\":\"+919876543210\",\"appointment_type\":\"OPD\",\"appointment_date\":\"2026-05-20\",\"appointment_time\":\"10:30\",\"status\":\"pending\",\"doctor_id\":\"doc-001\",\"doctor_name\":\"Dr. Example\"}"
```

**Example 201 response (new booking):**

```json
{
  "success": true,
  "data": {
    "name": "appt-uuid-here",
    "booking_id": "BK-2026-00001",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "patient_email": "patient@example.com",
    "status": "pending",
    "modified": "2026-05-12 10:40:00.000000"
  }
}
```

**Example 200 response (same `booking_id` again — update):** same `{ "success": true, "data": { ... } }` shape.

---

## 12) Create Mobile App Notification

**`POST /api/v1/notifications`** → **201** or **404**

You may send `type`; it is stored as `notification_type` in Frappe.

```bash
curl -sS -X POST "http://localhost:3101/api/v1/notifications" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"title\":\"Reminder\",\"body\":\"Take your medicine\",\"type\":\"reminder\",\"additional_data\":{\"screen\":\"home\"},\"is_read\":false}"
```

**Example 201 response:**

```json
{
  "success": true,
  "data": {
    "name": "notif-uuid-here",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Reminder",
    "body": "Take your medicine",
    "notification_type": "reminder",
    "is_read": 0,
    "modified": "2026-05-12 10:42:00.000000"
  }
}
```

---

## 13) Create Mobile App Support Ticket

**`POST /api/v1/support-tickets`** → **201** or **404**

Request body may use `name` for the requester; Frappe field is `requester_name`.

```bash
curl -sS -X POST "http://localhost:3101/api/v1/support-tickets" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"external_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"name\":\"Test Patient\",\"email\":\"patient@example.com\",\"phone\":\"+919876543210\",\"subject\":\"App crash on login\",\"description\":\"Steps: open app, tap login...\",\"priority\":\"high\",\"status\":\"open\"}"
```

**Example 201 response:**

```json
{
  "success": true,
  "data": {
    "name": "ticket-uuid-here",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "requester_name": "Test Patient",
    "subject": "App crash on login",
    "priority": "High",
    "status": "Open",
    "modified": "2026-05-12 10:45:00.000000"
  }
}
```

---

## 14) Create Mobile App Webhook Event

**`POST /api/v1/webhook-events`** → **201**

User is optional. Lookup uses `customer_id`, `customer_email`, `user_external_id`, `email`, etc.

```bash
curl -sS -X POST "http://localhost:3101/api/v1/webhook-events" \
  -H "Content-Type: application/json" \
  -H "X-ERP-Token: YOUR_APP_TOKEN" \
  -d "{\"event\":\"health_data_sync\",\"tool\":\"bp_data\",\"customer_email\":\"patient@example.com\",\"customer_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"timestamp\":\"2026-05-12T10:00:00Z\",\"data\":{\"systolic\":118},\"success\":true,\"status_code\":200,\"response_payload\":{\"ok\":true}}"
```

**Example 201 response:**

```json
{
  "success": true,
  "data": {
    "name": "wh-uuid-here",
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "event": "health_data_sync",
    "tool": "bp_data",
    "success": 1,
    "status_code": 200,
    "modified": "2026-05-12 10:50:00.000000"
  }
}
```

---

## Bearer auth (alternative to `X-ERP-Token`)

```bash
curl -sS "http://localhost:3101/api/v1/users/lookup?email=patient@example.com" \
  -H "Authorization: Bearer YOUR_APP_TOKEN"
```

---

## Postman

Step-by-step: [`POSTMAN.md`](./POSTMAN.md). Import [`postman/SRIAAS-backend-erp.postman_collection.json`](./postman/SRIAAS-backend-erp.postman_collection.json) and [`postman/SRIAAS-backend-erp.postman_environment.json`](./postman/SRIAAS-backend-erp.postman_environment.json).

---

## Notes

- **Full route inventory:** see the **Scope — is this the full API** section at the top of this file.
- Example `data` fields and timestamps are illustrative; Frappe returns whatever your DocTypes and permissions allow.
- **Link** fields (`user_id`, `disease_id`, `doctor_id`) must match existing Frappe document **names** for those DocTypes.
- See also `README.md` and `.env.example` in this folder.

### Route → Frappe DocType (quick map)

| HTTP route | Frappe DocType (default name) |
|------------|-------------------------------|
| `POST /api/v1/users/sync` | Mobile App User |
| `POST /api/v1/users/sessions/sync` | Mobile App User Session |
| `GET /api/v1/users/lookup` | *(read)* Mobile App User |
| `POST /api/v1/profiles/sync` | Mobile App User Profile |
| `POST /api/v1/diseases/sync` | Mobile App Disease |
| `POST /api/v1/disease-selections` | Mobile App User Disease Selection |
| `POST /api/v1/health-entries` | Mobile App Health Entry |
| `POST /api/v1/prescriptions` | Mobile App Prescription |
| `POST /api/v1/doctors/sync` | Mobile App Doctor |
| `POST /api/v1/appointments` | Mobile App Appointment |
| `POST /api/v1/notifications` | Mobile App Notification |
| `POST /api/v1/support-tickets` | Mobile App Support Ticket |
| `POST /api/v1/webhook-events` | Mobile App Webhook Event |
| `GET /api/health` | *(none — local status only)* |
