# Phase 2 Design — Nutrient Viewer for ServiceNow Workspace

**Date:** 2026-07-20
**Status:** Approved design, pre-implementation
**Author:** Jon Addams (Nutrient SE) with Claude Code
**Supersedes:** the `workspace/README.md` stub

---

## 1. Purpose & context

Phase 1 delivered a **classic / Platform UI** integration between ServiceNow and the Nutrient Web SDK: a fulfiller opens a record attachment in an in-browser Nutrient viewer to **view / annotate / save-as-PDF / digitally sign** (signing via Nutrient DWS), all in-platform. It is verified live on `dev438024.service-now.com`, security-hardened, and frozen.

Phase 2 delivers the **same capability for the Next Experience / UX Framework** ("Workspace" — Agent Workspace / Service Operations Workspace, Seismic components). The classic client **cannot port**: Workspace has no `onLoad` client scripts and no attachment `<a href="/sys_attachment.do">` in the DOM to intercept, and attachment clicks open ServiceNow's own native preview. This is therefore a **new Workspace-native client build**, reusing the existing server layer.

### Deliverable type
**Reference implementation** (a proof of concept). The bar is *correct, complete, well-documented source* that a customer developer can deploy — customers are expected to extend it. It is **not** required to be stood up live on an instance during this build. Because the ServiceNow runtime glue (component registration, declarative action, modal wiring, CSP) cannot be exercised without a deploy, those parts are documented with an on-instance validation checklist rather than claimed as verified.

### Non-goals
- Not refactoring the verified classic build (Phase 1 stays frozen — see §7).
- Not Nutrient Instant / real-time collaboration.
- Not a persistent Workspace tab or side panel (launch is per-attachment modal — see §4).
- Not automated ServiceNow-runtime testing (no instance in-loop this session).

---

## 2. Architecture overview

A scoped-app-style deliverable under `workspace/`, plus two small additions to `shared/`:

```
shared/                         (server layer — UI-agnostic)
  Script Include - NutrientAttachmentHelper.js      [existing, unchanged]
  Script Rest API - Nutrient DWS API - sign.js      [existing, unchanged]
  Script Rest API - metadata.js                     [NEW — REST wrapper over Script Include]
  Script Rest API - certificates.js                 [NEW — REST wrapper over Script Include]
  certificates/                                     [existing, unchanged]

workspace/                      (Workspace-native client)
  src/x-nutrient-viewer/
    index.js                    createCustomElement component shell
    viewer-controller.js        framework-agnostic viewer logic (testable)
    styles.scss                 container sizing
  now-ui.json                   component manifest + uiBuilder block
  now.config.json               project/instance config (templated, no secrets)
  package.json                  snc build deps
  README.md                     deploy runbook + on-instance validation checklist
```

**Why GlideAjax is not reused:** the classic UI Page calls `NutrientAttachmentHelper` via **GlideAjax**, which depends on the classic client runtime and is **not supported in UXF**. The fix is to expose the *same* Script Include methods over **Scripted REST** so the Workspace component can reach them via `fetch`. The Script Include stays the single source of server logic, now exposed two ways (GlideAjax for classic, REST for Workspace).

---

## 3. Components & responsibilities

Each unit has one clear purpose, a defined interface, and known dependencies.

### 3.1 `src/x-nutrient-viewer/index.js` — component shell
- **Does:** declares the custom element `x-nutrient-viewer` via `createCustomElement` (`@servicenow/ui-core`, snabbdom renderer). Declares `properties`: `attachmentId`, `table`, `recordId`. Renders a sized container `<div>` and captures the real DOM element with a snabbdom `insert` hook (survives shadow DOM), dispatching a `MOUNT` action. Holds `initialState` (`instance`, `status`, `error`) and `actionHandlers` for `MOUNT`, `SAVE`, `SIGN`, `DISCONNECT`.
- **Interface:** properties in (`attachmentId`/`table`/`recordId`); emits component events on success/error for the host page.
- **Depends on:** `viewer-controller.js`, `@servicenow/ui-core`, `@servicenow/ui-renderer-snabbdom`.
- **Does NOT:** contain SDK/DWS logic directly (delegates to the controller).

### 3.2 `src/x-nutrient-viewer/viewer-controller.js` — framework-agnostic viewer logic
- **Does:** all imperative Nutrient logic, with **no ServiceNow or snabbdom dependency** so it runs in the local harness:
  - `ensureSdkLoaded(cdnUrl)` — inject the CDN UMD `<script>` once, resolve when `window.NutrientViewer` exists.
  - `loadDocument({ container, arrayBuffer, licenseKey, toolbarItems })` — `NutrientViewer.load({ container, document: arrayBuffer, useCDN: true, licenseKey, toolbarItems })`.
  - `buildToolbar({ onSave, onSign })` — toolbar config with custom Save / Digitally Sign buttons.
  - `saveToRecord(instance, uploadFn)` — `exportPDF()` then hand bytes to an injected `uploadFn`.
  - `signDocument(instance, signUrl, origin)` — `fetch` the sign endpoint, then `instance.signDocument({ signingData: { signatureType: CAdES, padesLevel: b_lt } }, { jwt })`.
  - `loadTrustedCerts(certsUrl)` — feed `trustedCAsCallback`.
  - `hasSignature(instance)` — used to disable Save once signed (see §5).
- **Interface:** pure functions taking dependencies as arguments (URLs, fetch, container). No globals beyond the SDK it loads.
- **Depends on:** the Nutrient Web SDK global (loaded at runtime), `fetch`.

### 3.3 `shared/Script Rest API - metadata.js` — attachment metadata endpoint
- **Does:** a Scripted REST resource that instantiates `NutrientAttachmentHelper` server-side and returns `getAttachmentInfo()` output as JSON. Runtime: ECMAScript 2021 mode ON.
- **Interface:** `GET /api/<ns>/nutrient_dws_signing/metadata?sys_id=<attachmentSysId>` → `{ success, fileName, sizeBytes, contentType, tableName, tableId, createdOn }`.
- **Auth:** role-gated `nutrient_user` OR `admin`; reuses the Script Include's existing per-record access check.
- **Note:** `getAttachmentInfo()` currently reads `this.getParameter('sysparm_sys_id')` (GlideAjax convention). The REST wrapper passes the query param through to the helper. Implementation detail: either set the parameter on the helper instance or add a plain-args method to the Script Include — resolved in the plan; the Script Include's access-control logic is reused either way.

### 3.4 `shared/Script Rest API - certificates.js` — trusted certs endpoint
- **Does:** Scripted REST resource returning `NutrientAttachmentHelper.getTrustedCertificates()` output. Runtime: ECMAScript 2021 mode ON.
- **Interface:** `GET /api/<ns>/nutrient_dws_signing/certificates` → `{ success, certificates: [pem, ...] }`.
- **Auth:** role-gated `nutrient_user` OR `admin`.

### 3.5 `now-ui.json` / `now.config.json` / `package.json`
- **Does:** component manifest (element tag, properties, `uiBuilder` block so the component appears in the UI Builder palette) and `snc` build/deploy config. `now.config.json` is templated — **no credentials committed** (instance URL/login supplied by the deploying dev, consistent with the `.env.local` gitignore rule).

---

## 4. Data flow — per-attachment open

1. Agent clicks **Open in Nutrient**, a per-attachment **declarative action** on the Workspace attachments experience. The action fires with the attachment context (attachment sys_id + parent record).
2. A UI Builder **"open modal" (Custom type)** event opens a modal hosting `x-nutrient-viewer`, binding `attachmentId` (+ parent `table`/`recordId`) from the action payload.
3. Component mounts → `fetch('/sys_attachment.do?sys_id=<id>', { credentials: 'same-origin' })` → `arrayBuffer`. (Same-origin; session cookie; ACLs still apply. No CSP `connect-src` change needed for the instance itself.)
4. `ensureSdkLoaded()` then `loadDocument({ container, arrayBuffer, licenseKey, toolbarItems })` renders the viewer.
5. **Save:** `exportPDF()` → upload the bytes via the Attachment API (`POST /api/now/attachment/file?table_name=<t>&table_sys_id=<id>&file_name=<name>`) → delete the original attachment (mirrors classic save-as-PDF-back-to-record).
6. **Sign:** `fetch(POST /api/<ns>/nutrient_dws_signing/sign)` (existing endpoint) mints a DWS token — response `{ accessToken, id }` — used as the JWT for `instance.signDocument({ signingData: { signatureType: NutrientViewer.SignatureType.CAdES, padesLevel: NutrientViewer.PAdESLevel.b_lt } }, { jwt: accessToken })`. `trustedCAsCallback` is fed from the new `/certificates` endpoint.

**Namespace:** the scope namespace is `2169521` on the current instance; docs use `<ns>` and instruct the deployer to substitute their `glide.appcreator.company.code`.

---

## 5. Known-limitation UX — sign-then-save

Phase 1 documented that signing then saving **invalidates the signature** (Save runs `exportPDF()` + re-upload, which re-serializes the PDF and breaks the existing signature's byte range — "document has been tampered with"). This is a product-level constraint, not a bug.

**Phase 2 handles it by disabling Save once the document contains a signature** (`hasSignature(instance)` → hide/disable the custom Save toolbar button), so a signed document cannot be silently corrupted. This is a deliberate improvement over classic (which left both actions live). Documented in `workspace/README.md`.

---

## 6. Error handling

| Failure | Behavior |
|---|---|
| Attachment fetch fails / ACL denied | In-modal error state ("Unable to load attachment — you may not have access"), never a blank viewer. |
| SDK script blocked (CSP/CDN) | Explicit message: "Viewer failed to load — verify CSP trusted domains (see README)." This is the most likely deployment snag. |
| `loadDocument` throws | Error state with the SDK message; modal remains closable. |
| Sign token mint non-2xx (`/sign`) | Error toast surfacing the endpoint's `error` field; viewer stays usable for view/annotate. |
| Save upload fails | Error toast; original attachment is **not** deleted (delete only after a confirmed successful upload). |

All error paths fail safe (no data loss, no silent success) — consistent with Phase 1's hardening posture.

---

## 7. Relationship to the classic build (frozen)

The verified Phase 1 classic UI Page is **not modified**. Rationale: it is verified live and we cannot re-verify it this session; refactoring it to consume a shared module would add regression risk for no POC benefit. The Workspace component is **standalone but internally well-factored** — `viewer-controller.js` is a clean, framework-agnostic module that mirrors the classic viewer logic and becomes the single conceptual source going forward. A customer (or a later phase) could retrofit classic onto it; that is explicitly out of scope here.

The **server layer is genuinely shared**: the existing Script Include and `/sign` endpoint are reused unchanged; the two new REST resources are thin wrappers over the same Script Include.

---

## 8. Verification strategy (no live instance this session)

1. **Static checks:** `node --check` and lint on all new JS; grep for the load-bearing tokens (`CAdES`, `PAdESLevel.b_lt`, `useCDN`, `licenseKey`, `trustedCAsCallback`).
2. **Local harness:** exercise `viewer-controller.js` in the existing `local-harness/` (which already proves SDK load + `exportPDF` + end-to-end DWS signing offline against the live key). Because the controller is framework-agnostic, the harness can import it directly — this validates the *viewer logic* without ServiceNow.
3. **On-instance checklist (documented, for the deploying dev):** deploy component via `snc ui-component deploy`; place in UI Builder; create the attachment declarative action + modal; configure CSP; role-gate the new REST endpoints; then walk view / annotate / save / sign as a `nutrient_user` non-admin.

The ServiceNow-runtime glue is explicitly **documented-but-unverified** — not claimed as working.

---

## 9. Open items to validate on-instance (from research)

These are captured as a "validate on deploy" section in `workspace/README.md`, not blockers:

1. **CSP config surface (highest risk).** The exact table/property/Security-Center path to add trusted domains was ambiguous in current docs. Required directives: `script-src` + `connect-src` for `https://cdn.cloud.pspdfkit.com` and `connect-src` for `https://api.nutrient.io`; `'wasm-unsafe-eval'` (Nutrient WASM); `worker-src blob:` / `child-src blob:`. **Alternative that avoids CDN in CSP:** host the SDK JS + WASM assets inside the instance and set `baseUrl` to the instance origin. Needs a security admin (instance-wide).
2. **Attachment declarative-action payload field names** carrying the attachment sys_id / parent record — confirm by inspecting the event payload on-instance.
3. **Precise lifecycle action timing** (`COMPONENT_CONNECTED` vs `COMPONENT_RENDERED`) for a DOM-ready mount in the target release.
4. **Client-generated-scripts sandbox** — if enabled on the prospect's instance, dynamic `<script>` injection may be blocked; fall back to bundling the SDK + instance-hosted assets.
5. **Nutrient current CSP directive list** — confirm against the Nutrient Web SDK docs for the shipping SDK version.

---

## 10. Build sequence (feeds the implementation plan)

1. Add the two `shared/` Scripted REST resources (metadata, certificates) + confirm the Script Include exposes its logic to them.
2. Scaffold the `snc ui-component` project in `workspace/`.
3. Implement `viewer-controller.js` (framework-agnostic) and validate it in `local-harness/`.
4. Implement `index.js` component shell (mount, save, sign, error states) + `now-ui.json`.
5. Write `workspace/README.md`: deploy runbook, CSP config, declarative-action + modal setup, role-gating, on-instance validation checklist, and the sign-then-save note.
6. Static verification pass.
