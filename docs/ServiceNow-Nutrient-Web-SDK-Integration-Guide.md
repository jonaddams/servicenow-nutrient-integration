# ServiceNow ↔ Nutrient Web SDK Integration Guide

> **Note:** This is the original integration guide (converted from the inherited `.docx` to Markdown so it renders without Word). For the **updated, corrected runbook** — including the newer‑release ACL/sandbox steps, the server‑side certificate loading, and the known limitations discovered during testing — see [`deployment-guide.html`](./deployment-guide.html).

Before diving into the details, here is the big picture: by the end of this walkthrough you will have a seamless, in‑platform document viewer that

1. intercepts attachment clicks,
2. launches the Nutrient Web SDK full‑screen,
3. supports digital signatures via a Scripted REST API, and
4. writes the signed or PDF‑converted file back to the originating record, all without leaving the native UI.

## Executive Summary

The solution is delivered as a lightweight Global application containing five main artefacts:

- **`nutrient_hook` client script** – captures clicks on any `/sys_attachment.do` link.
- **`nutrient_pdf_viewer` UI Page** – hosts the Nutrient Web SDK and custom toolbar logic.
- **`NutrientAttachmentHelper` Script Include** – returns attachment metadata via GlideAjax.
- **X.509 certificates** – uploaded to `sys_certificate` so the SDK can validate signatures.
- **Nutrient DWS API `/sign` Scripted REST resource** – proxies signing requests to Nutrient's cloud.

Each component is explained step‑by‑step below with full code snippets and configuration checks.

## 1. Prerequisites & Instance Preparation

### 1.1 Spin up a Dev Instance
Create a latest personal developer instance, log in as admin, and switch to the Global scope.

### 1.2 Open ServiceNow Studio
Navigate to **All → ServiceNow Studio** and click **Create App**. Supply a name such as `nutrient-viewer`, choose **Global** scope, and press **Continue**.

### 1.3 Roles & Update Set
Add the following roles before proceeding:

- `admin` – full configuration
- `user` – end‑user testing
- `snc_internal` – REST access for the Scripted API (optional)

Click **Create** to generate the empty application and open the file hierarchy.

## 2. Client‑Side Attachment Interceptor

### 2.1 Create Script: `nutrient_hook`
**Studio → Client Scripts → New**

- **Name:** `nutrient_hook`
- **UI Type:** All
- **Type:** onLoad
- **Isolate script:** false *(critical — disables the DOM sandbox)*

The script attaches a capture‑phase click listener that detects any link pointing to `/sys_attachment.do`, extracts the `sys_id`, suppresses the native handler, and calls `openNutrientViewerFullscreen(sysId)`. It also injects CSS at runtime to paint a dark overlay, animates entrance/exit, and exposes a message bus.

## 3. Nutrient Viewer Container (UI Page)

### 3.1 Create UI Page
**Studio → System UI → UI Pages → New**

- **Name:** `nutrient_pdf_viewer`
- **Category:** General

#### 3.1.1 HTML section
Insert the Jelly template. It:

- Occupies 100 vh to go full‑screen.
- Loads `nutrient-viewer.js` from the Nutrient CDN.
- Shows a spinner while the SDK initialises.

#### 3.1.2 Client Script section
Add the JavaScript from `UI Page - nutrient_pdf_viewer.js`. Key duties:

- Disable Prototype/Effect/jQuery globals that conflict with modern JS.
- Call GlideAjax (`NutrientAttachmentHelper`) for metadata.
- Fetch the binary via the Fetch API with `X-UserToken`.
- Initialise `NutrientViewer.load` with a custom toolbar, save button, and signature button.
- Use `trustedCAsCallback` to stream trusted X.509 certificates to the SDK for LTV validation.
- Persist changes back to the record, deleting the original attachment and posting a `DOCUMENT_SAVED` message to the parent window.

## 4. Server‑Side Glue Code

### 4.1 Script Include: `NutrientAttachmentHelper`
**Studio → Server Development → Script Includes → New**

- **Name:** `NutrientAttachmentHelper`
- **Client callable:** true

The `getAttachmentInfo` method returns filename, size, content‑type, table, record, and creation date via a single AJAX round‑trip. This keeps the client lightweight and avoids an extra REST call.

### 4.2 Upload Certificates
Navigate to **System Definition → Certificates** and click **New**. Paste each PEM (root + intermediate + end‑entity) into **PEM Certificate** and mark **Active = true**. These feed the `trustedCAsCallback`, enabling signature validation inside the viewer.

## 5. Scripted REST API – Nutrient DWS

### 5.1 Create API
**Studio → Outbound Integrations → Scripted REST APIs → New**

- **Name:** `Nutrient DWS API`
- **API ID:** `nutrient_dws_signing`

### 5.2 Create Resource `/sign`
Within the API → **Resources → New**

- **Relative path:** `/sign`
- **Method:** POST

### 5.3 Configure the API Namespace per Instance
The signing URL contains a namespace segment unique to each ServiceNow instance. Before deploying, set it correctly.

**Find the namespace:** On the target instance, navigate to `sys_properties.list` and search for `glide.appcreator.company.code`. The **Value** is your namespace (e.g. `acguk`, `34257`). Alternatively, open any existing Scripted REST API in Studio — the namespace appears in the **Base API path** field.

**Set it in the UI Page:** Open the `nutrient_pdf_viewer` UI Page → HTML section. At the top of the inline `<script>` block, update:

```js
var NUTRIENT_API_NAMESPACE = 'REPLACE_WITH_COMPANY_CODE';
```

Replace `REPLACE_WITH_COMPANY_CODE` with the value found above. Save the record.

The resource script retrieves a property `nutrient.dws.api.token`, builds a JSON payload (`allowedOperations`, `allowedOrigins`, `expirationTime`), and calls `https://api.nutrient.io/tokens` to mint a short‑lived access token. The returned JWT is sent back to the UI page for hash‑only signing.

## 6. End‑to‑End Flow

| # | Action | Component | Result |
|---|--------|-----------|--------|
| 1 | User clicks any attachment | `nutrient_hook` | Default download cancelled; overlay opens |
| 2 | Overlay loads UI page | `nutrient_pdf_viewer` | Viewer initialises, spinner shows |
| 3 | AJAX fetches metadata | `NutrientAttachmentHelper` | Filename & size returned |
| 4 | Attachment downloaded via Fetch | Browser | Binary converted to ArrayBuffer |
| 5 | Viewer renders document | Nutrient Web SDK | User can annotate, sign, or edit |
| 6 | User presses Save | UI page | PDF export → `/attachment/file` POST → old file deleted |
| 7 | Parent window receives `DOCUMENT_SAVED` | `nutrient_hook` | Page reloads so list shows the new PDF |
| 8 | User presses Digitally Sign | UI page → REST API | JWT minted; SDK performs hash‑only signing |

## 7. Testing Checklist

- Open any Incident, attach a DOCX, refresh, then click the filename — the viewer should launch.
- Annotate, click Save, and confirm the original DOCX is replaced by a PDF of the same name.
- Click Digitally Sign → confirm the signature banner reads "valid" and the signed PDF is stored with a new revision.
- The Escape key closes the overlay and the record reloads automatically.
- If you see a blank viewer, ensure **Isolate script** is unchecked and `glide.script.block.client.globals=false` (or use scoped overrides).

## 8. Troubleshooting & Best Practices

- **GlideAjax errors:** Prototype must be temporarily restored before the call, then nulled again to prevent SDK clashes.
- **CSP blocks:** Add `cdn.cloud.pspdfkit.com` (or your Nutrient CDN domain) to Trusted Domains.
- **Large files:** The SDK is tested to 100 MB; for >100 MB use streaming or chunked uploads.
- **Signature validation fails:** Confirm the full CA chain is present and Active; verify the certificate subject matches the signer.

## 9. Conclusion

With fewer than 400 lines of client code and one Scripted REST endpoint, the Nutrient Web SDK is fully embedded inside ServiceNow, enabling rich document editing, PDF conversion, and cryptographic signing without moving data outside the platform or forcing users to download files locally. Because all logic lives in the Global scope, the solution is upgrade‑safe and can be cloned to other instances by moving the application update‑set and re‑uploading PEM certificates.

Feel free to extend the toolbar, add watermarking, or incorporate additional REST resources as compliance needs evolve.
