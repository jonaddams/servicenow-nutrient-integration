# Step 1 — Shared server layer

**Deploy this first, once per instance, before either client.** These artifacts are the same no matter which ServiceNow UI you use — the [Classic](../classic-ui) and [Workspace](../workspace) clients both rely on them.

← Back to the [project overview](../README.md).

### What you'll deploy here

| # | Artifact | ServiceNow record type | Used by |
|---|---|---|---|
| 1 | `Script Include - NutrientAttachmentHelper.js` | Script Include (client‑callable) | Both clients |
| 2 | `Script Rest API - Nutrient DWS API - sign.js` | Scripted REST resource — `POST /sign` | Both clients |
| 3 | `Script Rest API - metadata.js` | Scripted REST resource — `GET /metadata` | **Workspace only** |
| 4 | `Script Rest API - certificates.js` | Scripted REST resource — `GET /certificates` | **Workspace only** |
| 5 | `certificates/*.pem` | `sys_certificate` records (×3) | Both clients |

> **Classic‑only?** You can skip resources 3 and 4 (the Classic client reads metadata and certificates through the Script Include directly). Deploying them anyway is harmless.

Everything installs in the **Global** application scope. Log in as **admin**.

---

## Before you start — find your API namespace

Several places reference a per‑instance **namespace** (a short company code). Find it once now:

1. In the ServiceNow filter navigator, type **`sys_properties.list`** and press Enter.
2. Search for the property **`glide.appcreator.company.code`**.
3. Note its **Value** — it's a short code or number, e.g. `2169521`.

Wherever this guide shows `<namespace>`, substitute that value. (You can also read it later from the **Base API path** of the Scripted REST API you create in Step 2.)

---

## 1. Script Include — `NutrientAttachmentHelper`

Returns attachment metadata and loads the trusted CA chain **server‑side**, so end users never need direct access to the certificate table. Enforces per‑record read access.

1. Filter navigator → **`sys_script_include.list`** → **New**.
2. Set:
   - **Name:** `NutrientAttachmentHelper`
   - **Client callable:** ✅ **checked**
   - **Application:** Global
3. Turn **on** the **ECMAScript 2021 mode** toggle above the Script field (this code uses modern JavaScript).
4. Paste the entire contents of **`Script Include - NutrientAttachmentHelper.js`** into the **Script** field.
5. **Submit/Update.** If prompted to create an access control (ACL) on save, allow it — you'll grant it to `nutrient_user` in Step 6.

> ⚠️ **If an older version already exists on this instance, replace its Script field with this file.** This version adds the `getAttachmentDetails()` and `getTrustedCertificatesData()` methods the Workspace REST resources need; without them those calls fail.

---

## 2. Scripted REST API — `Nutrient DWS API`

### 2a. Create the API

1. Filter navigator → **`sys_ws_definition.list`** → **New**.
2. Set:
   - **Name:** `Nutrient DWS API`
   - **API ID:** `nutrient_dws_signing`
   - **Application:** Global
3. **Submit**, then reopen the record. The **Base API path** now shows `/api/<namespace>/nutrient_dws_signing` — confirm the namespace matches what you found above.

### 2b. Add the resources

In the API record, scroll to the **Resources** related list → **New**, once per resource:

| Resource | HTTP method | Relative path | Paste this file into **Script** |
|---|---|---|---|
| `sign` | **POST** | `/sign` | `Script Rest API - Nutrient DWS API - sign.js` |
| `metadata` *(Workspace only)* | **GET** | `/metadata` | `Script Rest API - metadata.js` |
| `certificates` *(Workspace only)* | **GET** | `/certificates` | `Script Rest API - certificates.js` |

For **each** resource:
- Turn **on** the **ECMAScript 2021 mode** toggle.
- Paste the matching file into the **Script** field.
- **Submit.**

> ⚠️ **ECMAScript 2021 mode is required on every server script (the Script Include and all resources).** If it's off, the script fails to compile and calls return **HTTP 500 with an empty body and nothing in the system log** — a confusing symptom whose fix is simply this toggle.

---

## 3. DWS API token (system property)

The server uses your Nutrient DWS token to mint short‑lived signing tokens. It stays server‑side and never reaches the browser.

1. Filter navigator → **`sys_properties.list`** → **New**.
2. Set:
   - **Name:** `nutrient.dws.api.token`
   - **Type:** `string`
   - **Value:** your `pdf_live_…` token from [`dashboard.nutrient.io`](https://dashboard.nutrient.io) → API keys
3. **Submit.** (Consider marking it private/protected per your instance's conventions.)

---

## 4. Trusted certificates

For signatures to validate as **valid** (green) instead of **warning** (untrusted), upload the DWS signing CA chain. The three PEM files are in [`certificates/`](./certificates).

1. Filter navigator → **`sys_certificate.list`** (or **All → System Definition → Certificates**) → **New**.
2. Create **three separate records**, one per file — do **not** combine them:

   | # | File | Certificate (CN) | Role in chain |
   |---|---|---|---|
   | 1 | `nutrient-dws-ca-1-atlas-r45-aatl-ca-2020.pem` | GlobalSign Atlas R45 AATL CA 2020 | Intermediate |
   | 2 | `nutrient-dws-ca-2-r45-aatl-root-ca-2020.pem` | GlobalSign R45 AATL Root CA 2020 | Intermediate |
   | 3 | `nutrient-dws-ca-3-document-signing-root-r45.pem` | GlobalSign Document Signing Root R45 | Root anchor (self‑signed) |

   For each: **Format** = `PEM`, **Active** = ✅, and paste the file's contents into **PEM Certificate**.

> The combined `nutrient-dws-ca-chain.pem` is for reference only — **don't** paste it into a single record. The SDK can't parse multiple certificates concatenated in one field.
>
> These chain the DWS signer up to a publicly‑trusted, Adobe‑Approved‑Trust‑List (AATL) root, so the resulting signatures are genuinely valid — not self‑signed. End users need **no** access to `sys_certificate`; the Script Include reads them server‑side.

---

## 5. Role — `nutrient_user`

Create the role that non‑admin fulfillers will hold. (Admins already have access.)

1. Filter navigator → **`sys_user_role.list`** → **New**.
2. **Name:** `nutrient_user` → **Submit.**
3. Assign it to any non‑admin test user later (e.g. an `itil` user), so you can validate the non‑admin path.

---

## 6. Access control (ACLs)

Grant both `admin` and `nutrient_user` on the server artifacts so non‑admins can use the integration. **Editing ACLs requires elevating to `security_admin`** (avatar menu → **Elevate role** → check `security_admin`).

| ACL | Type | Operation | Roles |
|---|---|---|---|
| `NutrientAttachmentHelper` | `client_callable_script_include` | execute | `admin`, `nutrient_user` |
| `/api/*` | `REST_Endpoint` | `http_post` | `admin`, `nutrient_user` |
| `/api/*` *(Workspace only)* | `REST_Endpoint` | `http_get` | `admin`, `nutrient_user` |

> On newer releases, saving the client‑callable Script Include and the Scripted REST API may auto‑create ACLs and prompt you for a role — add `admin` and `nutrient_user` to each. The **`http_get`** `REST_Endpoint` ACL is only needed for the Workspace client's `GET /metadata` and `GET /certificates` calls.
>
> The Classic client also needs two **UI‑Page** ACLs — those are covered in the [Classic guide](../classic-ui/README.md), not here, because they don't apply to Workspace.

---

## Verify the server layer

Confirm the endpoints respond before deploying a client:

1. Open the **Nutrient DWS API** record → **Related Links → Explore REST API** (the REST API Explorer runs calls **as you**, using your session — the reliable way to test).
2. Select the `Nutrient DWS API` namespace, pick **`GET /certificates`**, click **Send** → expect **200** with a `certificates` array (the three PEMs).
3. Pick **`GET /metadata`**, add a query parameter `sys_id` = the sys_id of any PDF attachment (`sys_attachment.list`), **Send** → expect **200** with the file's metadata.

> A plain browser address‑bar GET will return "User Not Authenticated" — that's expected; the endpoints require the session token, which the REST API Explorer supplies. If you get **HTTP 500 with an empty body**, re‑check ECMAScript 2021 mode (Step 2) and that the Script Include has the current methods (Step 1).

---

## ✅ Done — now deploy your client

- **Classic UI →** [`../classic-ui/README.md`](../classic-ui/README.md)
- **Workspace →** [`../workspace/README.md`](../workspace/README.md)
