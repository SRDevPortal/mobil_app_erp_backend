# Postman setup (step by step)

Use this folder: `backend/backend-erp/postman/`

Files:

- `SRIAAS-backend-erp.postman_collection.json` — all API requests
- `SRIAAS-backend-erp.postman_environment.json` — `base_url` = `http://localhost:3101` + `app_token`
- `SRIAAS-backend-erp.postman_environment.ngrok.json` — same, but `base_url` = your **ngrok** URL (see [Using ngrok](#using-ngrok-tunnel))

More detail on bodies and status codes: `API.md` in the same parent folder (`backend/backend-erp/API.md`).

---

## Using ngrok (tunnel `localhost:3101`)

Your public URL maps to the app like this:

| Public (internet) | Your machine |
|-------------------|--------------|
| `https://diabetic-crux-unnatural.ngrok-free.dev` | `http://localhost:3101` |

### ngrok “Visit Site” warning (free plan)

In a **normal browser**, ngrok may show an interstitial page (“You are about to visit…”) before your API. Click **Visit Site** once per session, or use one of ngrok’s options: add request header **`ngrok-skip-browser-warning`** (any value), use a custom **User-Agent**, or use a paid ngrok plan (see [ngrok documentation](https://ngrok.com/docs/)).

**Postman:** The imported collection **`SRIAAS-backend-erp.postman_collection.json`** includes a **Collection pre-request script** that adds `ngrok-skip-browser-warning: true` to every request so you get **JSON**, not HTML. Re-import the collection if you have an older copy without the script.

**curl** (ngrok URL):

```bash
curl -sS "https://diabetic-crux-unnatural.ngrok-free.dev/api/health" \
  -H "ngrok-skip-browser-warning: true"
```

1. Start **backend-erp** locally so it listens on **3101** (`npm run dev` in `backend/backend-erp`).
2. In another terminal, start **ngrok** pointing at that port. If this hostname is a **reserved domain** on your ngrok account:

   ```bash
   ngrok http 3101 --domain=diabetic-crux-unnatural.ngrok-free.dev
   ```

   If you do **not** use a reserved domain, run `ngrok http 3101` and use the URL ngrok prints instead (then set Postman `base_url` to that URL, or edit the ngrok environment JSON).

3. In Postman, **import** `postman/SRIAAS-backend-erp.postman_environment.ngrok.json` (or duplicate the local environment and set `base_url` to `https://diabetic-crux-unnatural.ngrok-free.dev` with **no trailing slash**).
4. Set **`app_token`** in that environment to match `APP_ERP_TOKEN` in `.env` → select that environment → run the same requests as local.

Your API already uses permissive **CORS**; callers through ngrok do not need a special CORS entry for this bridge layer.

---

## Step 1 — Install Postman

1. Download **Postman** from [https://www.postman.com/downloads/](https://www.postman.com/downloads/).
2. Install and open the app (sign-in is optional for local testing).

---

## Step 2 — Start your API server

1. In `backend/backend-erp`, copy `.env.example` to `.env`.
2. Set `APP_ERP_TOKEN`, `ERP_BASE_URL`, and `ERP_TOKEN` in `.env`.
3. Run `npm install` then `npm run dev` (or `npm start`).
4. Confirm **Health** works in a browser: `http://localhost:3101/api/health`  
   (Default port is **3101** unless you changed `PORT` in `.env`.)

---

## Step 3 — Import the environment

1. In Postman, click **Environments** in the left sidebar (or the **gear** icon on the top right → **Manage Environments**).
2. Click **Import**.
3. Choose **`postman/SRIAAS-backend-erp.postman_environment.json`** from this repo.
4. Open the imported environment **SRIAAS backend-erp (local)**.
5. Edit variable **`app_token`**: set its **current value** to the same string as `APP_ERP_TOKEN` in your `.env` file (replace `REPLACE_WITH_APP_ERP_TOKEN`).
6. If your server is not on `http://localhost:3101`, edit **`base_url`** (no trailing slash).
7. Click **Save**.

---

## Step 4 — Import the collection

1. Click **Collections** in the left sidebar.
2. Click **Import** (top left).
3. Drag in or select **`postman/SRIAAS-backend-erp.postman_collection.json`**.
4. You should see a collection named **SRIAAS backend-erp** with requests **1 Health** through **14 Webhook events**.

---

## Step 5 — Select the environment

1. Top-right of Postman, open the **environment dropdown** (often shows “No Environment”).
2. Choose **SRIAAS backend-erp (local)**.

Now `{{base_url}}` and `{{app_token}}` in every request resolve to your values.

---

## Step 6 — Send your first request

1. Open the collection **SRIAAS backend-erp**.
2. Click **1 Health (no auth)**.
3. Click **Send**.
4. You should get **200 OK** and JSON with `"success": true` and `"service": "sriaas-backend-erp"`.

This request does **not** use `X-ERP-Token`.

---

## Step 7 — Call a protected route

1. Run **2 Users — sync** first (creates/updates the user in Frappe).
2. Then try **3 Users — lookup**, **5 Profiles — sync**, etc.

If you get **401** with `"Invalid ERP token"`, see **Troubleshooting — Invalid ERP token** below.

If you get **500** or Frappe error text in `message`, check **`ERP_BASE_URL`**, **`ERP_TOKEN`**, and DocType permissions on the Frappe site.

---

## Troubleshooting — `Invalid ERP token` (401)

Do these in order:

1. **Restart the Node server** after you change `backend/backend-erp/.env`.  
   The app reads `APP_ERP_TOKEN` only when it starts. Stop the terminal (Ctrl+C), then run `npm run dev` again.

2. **Same string in two places**  
   - File: `backend/backend-erp/.env` → line `APP_ERP_TOKEN=...` (no spaces around `=`).  
   - Postman: your environment → **`app_token`** must be **exactly** the same characters (copy-paste from `.env` helps).

3. **Postman “Initial” vs “Current” value**  
   For **`app_token`**, set the **Current Value** (not only Initial), then **Save** the environment.  
   Top-right: make sure you **selected** that environment (not “No Environment”).

4. **Check the header is really sent**  
   Open the request → **Send** → below, open **Headers** in the response area or use **Console** (bottom of Postman).  
   You should see **`X-ERP-Token`** with your token (not the literal text `{{app_token}}`).  
   If you see `{{app_token}}`, the environment is not applied — fix step 3.

5. **One line in `.env`**  
   Use `APP_ERP_TOKEN=mysecret` without quotes unless you need special characters; avoid a second `APP_ERP_TOKEN=` line.

---

## Optional — Import a single `curl` from `API.md`

1. Copy a full `curl ...` block from **`API.md`**.
2. In Postman: **Import** → **Raw text** → paste → **Continue** → **Import**.

Postman creates a new request you can move into your collection.

---

## Optional — Use Bearer instead of `X-ERP-Token`

Your server accepts either header. To switch in Postman:

1. Open a request → **Authorization** tab.
2. Type: **Bearer Token**, Token: `{{app_token}}`.
3. Remove the **X-ERP-Token** header from the **Headers** tab for that request (to avoid duplication).

---

## Collection variables (sample IDs)

The collection defines **sample_user_external_id**, **sample_session_id**, **sample_disease_id**, **sample_doctor_id**.  
Edit them under the collection **Variables** tab if you want different test UUIDs or Frappe Link names ( **`disease_id` / `doctor_id` must match real Frappe document names** on your site).
