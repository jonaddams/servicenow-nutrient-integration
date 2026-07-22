# Classic UI client — deployment guide

The client for ServiceNow's **classic Platform UI** (traditional forms, "UI16"). Clicking an attachment on a record opens it full‑screen in the Nutrient viewer to view, annotate, save‑as‑PDF, and digitally sign. Validated end‑to‑end for both admin and non‑admin (`itil` + `nutrient_user`) users.

← Back to the [project overview](../README.md).

> **Prerequisite:** deploy the [shared server layer](../shared/README.md) **first**. This guide assumes the Script Include, the `POST /sign` resource, the DWS token property, the certificates, and the `nutrient_user` role are already in place.

### What you'll deploy here

| File | ServiceNow record | Purpose |
|---|---|---|
| `UI Page - nutrient_pdf_viewer.html` | UI Page — **HTML** field | Hosts the SDK container; loads `nutrient-viewer.js` from the CDN. |
| `UI Page - nutrient_pdf_viewer.js` | UI Page — **Client script** field | Loads the document, custom toolbar, save‑back, and digital signing. |
| `Client Script - Nutrient_hook.js` | Client Script (`onLoad`) | Intercepts attachment‑link clicks and opens the viewer full‑screen. |

Everything installs in **Global** scope. Log in as **admin**.

---

## 1. Create the viewer UI Page

1. Filter navigator → **`sys_ui_page.list`** → **New**.
2. Set:
   - **Name:** `nutrient_pdf_viewer` (must match exactly)
   - **Category:** General
   - **Application:** Global
3. Paste the contents of **`UI Page - nutrient_pdf_viewer.html`** into the **HTML** field.
4. Paste the contents of **`UI Page - nutrient_pdf_viewer.js`** into the **Client script** field.
5. **Submit.** If prompted for an access role on save, choose `admin` for now (you'll broaden it in Step 5).

> ⚠️ **Jelly gotcha — no `${…}` template literals in the UI Page.** ServiceNow UI Pages are Jelly templates and evaluate `${…}` **server‑side**, blanking any JavaScript template‑literal interpolation before it reaches the browser (symptom: a blank viewer, empty values in the console). In the **HTML** and **Client script** fields use **string concatenation** instead. `const`/`let`/arrow functions are fine. *(This applies only to the UI Page — not the client‑script hook or the server artifacts.)*

---

## 2. Set the namespace and license key

Two per‑instance values live in the UI Page:

| Setting | Where | Value |
|---|---|---|
| **API namespace** | **HTML** field → `NUTRIENT_API_NAMESPACE` | Your company code (from the [shared guide](../shared/README.md#before-you-start--find-your-api-namespace), e.g. `2169521`) |
| **Web SDK license key** | **Client script** field → `licenseKey` | Your domain‑matched Nutrient Web SDK key |

Edit both in the `nutrient_pdf_viewer` record and **Update**.

> ⚠️ The license key is **domain‑locked** — it must be issued for your instance host (e.g. `devXXXXX.service-now.com`). A mismatched key renders the viewer heavily watermarked and makes signatures look modified.

---

## 3. Create the attachment‑click hook

1. Filter navigator → **`sys_script_client.list`** → **New**.
2. Set:
   - **Name:** `nutrient_hook`
   - **Table:** `Incident [incident]` *(or the table where you want the viewer; repeat for others)*
   - **UI Type:** All
   - **Type:** `onLoad`
   - **Isolate script:** ❌ **unchecked** *(critical — see below)*
   - **Application:** Global
3. Paste the contents of **`Client Script - Nutrient_hook.js`** into the **Script** field.
4. **Submit.**

> ⚠️ **"Isolate script" must be OFF.** Isolated client scripts run in a stripped context with no real DOM, so the interceptor can't attach its click listener (symptom: `Cannot read properties of null (reading 'addEventListener')`). You must **also** set the system property `glide.script.block.client.globals` = `false` (next step).

---

## 4. Allow non‑isolated client globals

1. Filter navigator → **`sys_properties.list`** → **New** (or edit if it exists).
2. Set:
   - **Name:** `glide.script.block.client.globals`
   - **Type:** `true | false`
   - **Value:** `false`
3. **Submit.**

---

## 5. Access control for non‑admins

So non‑admin fulfillers (`itil` + `nutrient_user`) can open the viewer, add these **Classic‑specific** ACLs. (The Script Include and REST endpoint ACLs were done in the [shared guide](../shared/README.md#6-access-control-acls).) **Editing ACLs requires elevating to `security_admin`** (avatar → **Elevate role**).

| ACL | Type | Grants | Roles |
|---|---|---|---|
| `nutrient_pdf_viewer` | `ui_page` | Open the viewer page | `admin`, `nutrient_user` |
| `sys_ui_page` (read) | record — condition **Name is `nutrient_pdf_viewer`** | Non‑admins can render the UI Page | `nutrient_user` |

> Without the `sys_ui_page` read ACL, a non‑admin sees *"Security constraints prevent access to requested page."* Certificates are loaded server‑side, so users need **no** `sys_certificate` access.

---

## 6. Content Security Policy (only if the viewer is blocked)

Most instances load the SDK from the CDN without changes. If the viewer script is blocked (console shows a CSP/"Refused to load" error), add the Nutrient CDN to your Trusted Domains / CSP:

- `cdn.cloud.pspdfkit.com`

*(needs `security_admin`; the exact surface — **Security Center → Content Security Policy** vs. legacy CSP properties — varies by release.)*

---

## 7. Test

Flush the cache first: navigate to **`/cache.do`**. Then test on an **open** Incident in the **classic** form (attachments are hidden on closed records). Run as admin, then impersonate a non‑admin (`itil` + `nutrient_user`) and repeat.

| # | Action | Expected result |
|---|---|---|
| 1 | Attach a PDF, reload the form, click the filename | Dark overlay opens; the viewer renders the document |
| 2 | Annotate, then click **Save** | The attachment is replaced by a PDF of the same name |
| 3 | Open a fresh PDF, click **Digitally Sign** | Console shows certificates loaded, then `status: 'valid'`; a green "valid signature" banner appears |
| 4 | Press **Esc** | The overlay closes and the record reloads |

> **The browser console is your x‑ray.** The scripts log `STEP 1 … STEP 10` and `[AttachmentInterceptor]` messages. Wherever the sequence stops points straight at the failing stage.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Clicking an attachment just downloads it | Hook not running | "Isolate script" still checked, or the hook is on the wrong table |
| `Cannot read properties of null (addEventListener)` | Isolated client script | Uncheck **Isolate script**; set `glide.script.block.client.globals` = `false` |
| Blank viewer; values empty in the console | Jelly consumed `${…}` | Use string concatenation in the UI Page (see the Jelly note in Step 1) |
| "Security constraints prevent access to requested page" | Non‑admin missing a grant | Add `nutrient_user` to the UI Page + `sys_ui_page` read ACLs (Step 5); confirm the user actually holds the role |
| Viewer heavily watermarked | License domain mismatch | Use a key issued for your instance host (Step 2) |
| Signing returns HTTP 500 | ES2021 mode off, or bad DWS token | Enable ES2021 mode on the server artifacts; verify `nutrient.dws.api.token` (shared guide) |
| Signing returns HTTP 403 | Role / ACL | User needs `nutrient_user` or `admin`; add the role to the `REST_Endpoint` ACL (shared guide) |
| Signature shows **warning** | Trusted CA chain not loaded | Upload all three CA certs, Active (shared guide, Step 4) |
| Signature shows **error** / tampered | Document was Saved after signing | Expected — don't Save a signed document (see below) |

---

## Known limitations

- **Classic UI only.** This client relies on a client script + DOM interception, which run only in the classic platform UI. For Agent/Service Operations Workspace, use the [Workspace client](../workspace/README.md).
- **Sign, then Save, breaks the signature.** Save re‑exports and re‑uploads the PDF, rewriting the bytes and invalidating any existing signature. Treat signing and save/convert as mutually exclusive per document.
- **Evaluation license.** An evaluation Web SDK key renders cleanly but logs an "evaluation license" note in the console — swap in a production key before go‑live.
