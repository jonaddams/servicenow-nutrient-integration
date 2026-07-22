# Nutrient Viewer for ServiceNow Workspace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Workspace-native (UX Framework) Nutrient PDF viewer component with full classic parity (view / annotate / save-as-PDF / digitally sign), reusing the existing shared server layer plus two new Scripted REST endpoints.

**Architecture:** A custom UXF component (`x-nutrient-viewer`, built with the Now CLI) hosts `NutrientViewer.load()` and delegates all imperative viewer logic to a framework-agnostic `viewer-controller.js` module. It is launched per-attachment via a declarative action that opens a Custom modal. Because GlideAjax is unavailable in UXF, attachment metadata and trusted certs are exposed via two new Scripted REST resources that wrap the existing `NutrientAttachmentHelper` Script Include; the `/sign` endpoint and cert chain are reused unchanged. The verified classic build is left frozen.

**Tech Stack:** ServiceNow UX Framework (`@servicenow/ui-core`, snabbdom renderer), Now CLI (`@servicenow/cli` + `ui-component` extension), Scripted REST API (Rhino/ES2021), Nutrient Web SDK 1.17.0 (CDN), Nutrient DWS signing. Tests: Node built-in test runner (`node --test`) for the controller; `node --check` for server artifacts.

## Global Constraints

- **SDK:** Nutrient Web SDK, CDN URL `https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.17.0/nutrient-viewer.js`; always pass `useCDN: true`. Global is `NutrientViewer` (never `PSPDFKit`).
- **Signing:** token minted via `POST /api/<ns>/nutrient_dws_signing/sign`, response shape `{ success, accessToken, id, expiresIn, ... }`; use `accessToken` as the `jwt`. Sign call: `instance.signDocument({ signingData: { signatureType: NutrientViewer.SignatureType.CAdES, padesLevel: NutrientViewer.PAdESLevel.b_lt } }, { jwt })`.
- **Namespace:** the scope API namespace is `2169521` on the current instance. Expose it as a **configurable `namespace` component property** (declared in both `now-ui.json` and `index.js`) defaulting to `'2169521'` so the component works out-of-box on the current instance while remaining configurable per deployment. Use the `<ns>` placeholder in comments/docs. Endpoints live under the existing service `nutrient_dws_signing`.
- **Modern JS:** ES2021+, `const`/`let`, template literals, arrow functions. NO `var` — except the required `var NutrientAttachmentHelper = Class.create()` idiom in the Script Include.
- **Server runtime:** every Scripted REST resource and the Script Include MUST have **"ECMAScript 2021 mode" enabled** on its record (documented in README; cannot be set from source).
- **Roles:** all Nutrient endpoints are gated `nutrient_user` OR `admin`.
- **No secrets in git:** `now.config.json` is templated (no instance URL/credentials); consistent with the existing `.env.local` gitignore rule.
- **Classic frozen:** do NOT modify `classic-ui/`. Changes to `shared/NutrientAttachmentHelper.js` must be purely additive and preserve the existing GlideAjax method contracts.

---

### Task 1: Extract sysId-arg methods in NutrientAttachmentHelper (additive, shared)

Refactor the Script Include so its logic is callable both from GlideAjax (classic, using request params) and from a Scripted REST resource (Workspace, using an explicit argument). External GlideAjax behavior must be identical.

**Files:**
- Modify: `shared/Script Include - NutrientAttachmentHelper.js`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `getAttachmentDetails(sysId: string) → { success: boolean, error?: string, fileName?, sizeBytes?, contentType?, tableName?, tableId?, createdOn? }` (plain object, enforces access control).
  - `getTrustedCertificatesData() → { success: boolean, error?: string, certificates: string[] }` (plain object).
  - Existing `getAttachmentInfo()` / `getTrustedCertificates()` unchanged externally (now thin wrappers).

- [ ] **Step 1: Add `getAttachmentDetails(sysId)` and rewire `getAttachmentInfo()`**

Replace the `getAttachmentInfo()` method with the extracted pair (keep all `_`-helpers unchanged):

```javascript
    /**
     * Core attachment-metadata logic, callable with an explicit sys_id.
     * Enforces per-record access control. Returns a plain object (no GlideAjax
     * result element) so both GlideAjax and Scripted REST callers can use it.
     * @param {string} sysId
     * @returns {Object}
     */
    getAttachmentDetails(sysId) {
        try {
            if (!this._isValidSysId(sysId)) {
                return { success: false, error: 'Invalid or missing attachment ID' };
            }

            const attachmentGR = new GlideRecord('sys_attachment');
            if (!attachmentGR.get(sysId)) {
                return { success: false, error: 'Attachment not found' };
            }

            if (!this._hasAttachmentAccess(attachmentGR)) {
                gs.warn(`[NutrientAttachmentHelper.getAttachmentDetails] Access denied for ${gs.getUserName()} on attachment ${sysId}`);
                return { success: false, error: 'You do not have access to this attachment' };
            }

            return {
                success: true,
                fileName: this._sanitizeString(attachmentGR.getValue('file_name')) || 'Unknown',
                sizeBytes: parseInt(attachmentGR.getValue('size_bytes') || '0', 10),
                contentType: this._sanitizeString(attachmentGR.getValue('content_type')) || 'application/octet-stream',
                tableName: this._sanitizeString(attachmentGR.getValue('table_name')) || '',
                tableId: this._sanitizeString(attachmentGR.getValue('table_sys_id')) || '',
                createdOn: this._sanitizeString(attachmentGR.getValue('sys_created_on')) || ''
            };
        } catch (error) {
            return { success: false, error: `Server error: ${error.toString()}` };
        }
    },

    /**
     * GlideAjax entry point (classic UI). Contract unchanged.
     */
    getAttachmentInfo() {
        return this._result(this.getAttachmentDetails(this.getParameter('sysparm_sys_id')));
    },
```

- [ ] **Step 2: Add `getTrustedCertificatesData()` and rewire `getTrustedCertificates()`**

Replace the `getTrustedCertificates()` method with:

```javascript
    /**
     * Core trusted-cert logic. Returns a plain object usable by GlideAjax and REST.
     * Runs server-side, reading sys_certificate with full access regardless of caller roles.
     * @returns {Object} { success, certificates: [pem, ...] }
     */
    getTrustedCertificatesData() {
        try {
            const certificates = [];
            const certGR = new GlideRecord('sys_certificate');
            certGR.addQuery('active', true);
            certGR.query();

            while (certGR.next()) {
                const pem = certGR.getValue('pem_certificate');
                if (pem && pem.trim() !== '') {
                    certificates.push(pem);
                }
            }

            gs.info(`[NutrientAttachmentHelper.getTrustedCertificatesData] Returning ${certificates.length} certificate(s)`);
            return { success: true, certificates: certificates };
        } catch (error) {
            gs.error(`[NutrientAttachmentHelper.getTrustedCertificatesData] Error: ${error.toString()}`);
            return { success: false, error: `Server error: ${error.toString()}`, certificates: [] };
        }
    },

    /**
     * GlideAjax entry point (classic UI). Contract unchanged.
     */
    getTrustedCertificates() {
        return this._result(this.getTrustedCertificatesData());
    },
```

- [ ] **Step 3: Verify syntax**

Run: `node --check "shared/Script Include - NutrientAttachmentHelper.js"`
Expected: no output, exit code 0. (Parses only — GlideRecord/gs globals are not resolved, which is fine.)

- [ ] **Step 4: Verify GlideAjax contract preserved by inspection**

Confirm by reading the file: `getAttachmentInfo()` still reads `sysparm_sys_id` and wraps in `_result`; `getTrustedCertificates()` still wraps in `_result`; `_isValidSysId`, `_hasAttachmentAccess`, `_sanitizeString`, `_result`, and `type:` are unchanged. No `var` added.

- [ ] **Step 5: Commit**

```bash
git add "shared/Script Include - NutrientAttachmentHelper.js"
git commit -m "refactor(shared): extract sysId-arg methods in NutrientAttachmentHelper for REST reuse"
```

---

### Task 2: Add attachment-metadata Scripted REST resource

**Files:**
- Create: `shared/Script Rest API - metadata.js`

**Interfaces:**
- Consumes: `NutrientAttachmentHelper.getAttachmentDetails(sysId)` (Task 1).
- Produces: `GET /api/<ns>/nutrient_dws_signing/metadata?sys_id=<attachmentSysId>` → JSON `{ success, fileName, sizeBytes, contentType, tableName, tableId, createdOn }` or `{ success:false, error }`.

- [ ] **Step 1: Write the resource**

```javascript
/**
 * =============================================================================
 * NUTRIENT ATTACHMENT METADATA API
 * =============================================================================
 * Purpose: Expose attachment metadata to UX Framework (Workspace) clients,
 *          which cannot use GlideAjax. Thin wrapper over NutrientAttachmentHelper.
 * API Path: GET /api/<ns>/nutrient_dws_signing/metadata?sys_id=<attachmentSysId>
 * Runtime: Enable "ECMAScript 2021 mode" on this Scripted REST resource.
 * Security: role-gated (nutrient_user | admin); per-record access enforced by the Script Include.
 * =============================================================================
 */
(function process(request, response) {
    const LOG_PREFIX = '[Nutrient-Metadata-API]';

    if (!gs.hasRole('nutrient_user') && !gs.hasRole('admin')) {
        gs.warn(`${LOG_PREFIX} Unauthorized access by: ${gs.getUserName()}`);
        response.setStatus(403);
        response.setBody({ success: false, error: 'Insufficient privileges' });
        return;
    }

    const sysId = request.queryParams.sys_id ? String(request.queryParams.sys_id) : '';

    try {
        const helper = new NutrientAttachmentHelper();
        const result = helper.getAttachmentDetails(sysId);
        response.setStatus(result.success ? 200 : 400);
        response.setBody(result);
    } catch (error) {
        gs.error(`${LOG_PREFIX} Error: ${error.toString()}`);
        response.setStatus(500);
        response.setBody({ success: false, error: 'Internal server error' });
    }
})(request, response);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check "shared/Script Rest API - metadata.js"`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add "shared/Script Rest API - metadata.js"
git commit -m "feat(shared): add attachment-metadata Scripted REST resource for Workspace"
```

---

### Task 3: Add trusted-certificates Scripted REST resource

**Files:**
- Create: `shared/Script Rest API - certificates.js`

**Interfaces:**
- Consumes: `NutrientAttachmentHelper.getTrustedCertificatesData()` (Task 1).
- Produces: `GET /api/<ns>/nutrient_dws_signing/certificates` → JSON `{ success, certificates: [pem, ...] }`.

- [ ] **Step 1: Write the resource**

```javascript
/**
 * =============================================================================
 * NUTRIENT TRUSTED CERTIFICATES API
 * =============================================================================
 * Purpose: Expose active trusted CA certificates (PEM) to UX Framework clients
 *          for signature validation (trustedCAsCallback). GlideAjax-free.
 * API Path: GET /api/<ns>/nutrient_dws_signing/certificates
 * Runtime: Enable "ECMAScript 2021 mode" on this Scripted REST resource.
 * Security: role-gated (nutrient_user | admin).
 * =============================================================================
 */
(function process(request, response) {
    const LOG_PREFIX = '[Nutrient-Certificates-API]';

    if (!gs.hasRole('nutrient_user') && !gs.hasRole('admin')) {
        gs.warn(`${LOG_PREFIX} Unauthorized access by: ${gs.getUserName()}`);
        response.setStatus(403);
        response.setBody({ success: false, error: 'Insufficient privileges', certificates: [] });
        return;
    }

    try {
        const helper = new NutrientAttachmentHelper();
        const result = helper.getTrustedCertificatesData();
        response.setStatus(result.success ? 200 : 500);
        response.setBody(result);
    } catch (error) {
        gs.error(`${LOG_PREFIX} Error: ${error.toString()}`);
        response.setStatus(500);
        response.setBody({ success: false, error: 'Internal server error', certificates: [] });
    }
})(request, response);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check "shared/Script Rest API - certificates.js"`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add "shared/Script Rest API - certificates.js"
git commit -m "feat(shared): add trusted-certificates Scripted REST resource for Workspace"
```

---

### Task 4: Scaffold the Now CLI component project

Create the project files the Now CLI (`snc ui-component`) expects. These are authored by hand here (the CLI isn't run in this environment); the README documents reconciling them with `snc ui-component` on the deploying dev's machine.

**Files:**
- Create: `workspace/package.json`
- Create: `workspace/now.config.json`
- Create: `workspace/src/x-nutrient-viewer/now-ui.json`

**Interfaces:**
- Produces: an `snc`-buildable project exposing custom element `x-nutrient-viewer` with properties `attachmentId`, `table`, `recordId`, `namespace`, and a `uiBuilder` block.

- [ ] **Step 1: Write `workspace/package.json`**

```json
{
  "name": "x-nutrient-viewer",
  "version": "1.0.0",
  "description": "Nutrient PDF viewer component for ServiceNow Workspace (UX Framework)",
  "type": "module",
  "scripts": {
    "test": "node --test src/x-nutrient-viewer/",
    "develop": "snc ui-component develop",
    "deploy": "snc ui-component deploy"
  },
  "dependencies": {
    "@servicenow/ui-core": "*",
    "@servicenow/ui-renderer-snabbdom": "*"
  }
}
```

- [ ] **Step 2: Write `workspace/now.config.json` (templated — no secrets)**

```json
{
  "components": {
    "x-nutrient-viewer": {
      "innerComponents": [],
      "uiBuilder": { "associatedTypes": ["global.core"] }
    }
  }
}
```

- [ ] **Step 3: Write `workspace/src/x-nutrient-viewer/now-ui.json`**

```json
{
  "components": {
    "x-nutrient-viewer": {
      "properties": [
        { "name": "attachmentId", "label": "Attachment sys_id", "fieldType": "string", "defaultValue": "" },
        { "name": "table", "label": "Parent table", "fieldType": "string", "defaultValue": "" },
        { "name": "recordId", "label": "Parent record sys_id", "fieldType": "string", "defaultValue": "" },
        { "name": "namespace", "label": "Scope API namespace", "fieldType": "string", "defaultValue": "2169521" }
      ],
      "uiBuilder": {
        "associatedTypes": ["global.core", "record.page"],
        "label": "Nutrient PDF Viewer",
        "icon": "document-outline",
        "description": "Opens a record attachment in the Nutrient viewer to view, annotate, save, and digitally sign."
      }
    }
  }
}
```

- [ ] **Step 4: Verify all three files are valid JSON**

Run: `for f in workspace/package.json workspace/now.config.json workspace/src/x-nutrient-viewer/now-ui.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('OK $f')"; done`
Expected: three `OK <path>` lines, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add workspace/package.json workspace/now.config.json workspace/src/x-nutrient-viewer/now-ui.json
git commit -m "chore(workspace): scaffold Now CLI ui-component project"
```

---

### Task 5: Implement `viewer-controller.js` with TDD

The framework-agnostic viewer logic. All functions take their dependencies (SDK global, `fetch`, `document`) as arguments/options so they run under `node --test` with fakes. This is the one unit-testable module — write tests first.

**Files:**
- Create: `workspace/src/x-nutrient-viewer/viewer-controller.js`
- Test: `workspace/src/x-nutrient-viewer/viewer-controller.test.js`

**Interfaces:**
- Produces (all named ESM exports):
  - `SDK_CDN_URL: string`
  - `ensureSdkLoaded(cdnUrl?, { doc?, getGlobal? }?) → Promise<NutrientViewer>`
  - `buildToolbar(NutrientViewer, { onSave, onSign }) → Array`
  - `loadDocument(NutrientViewer, { container, arrayBuffer, licenseKey, toolbarItems, trustedCAsCallback }) → Promise<instance>`
  - `hasSignature(instance) → Promise<boolean>`
  - `saveToRecord(instance, uploadFn: (buffer) => Promise<void>) → Promise<void>`
  - `signDocument(instance, NutrientViewer, { signUrl, expirationTime?, fetchImpl? }) → Promise<void>`
  - `loadTrustedCerts(certsUrl, { fetchImpl? }?) → Promise<string[]>`

- [ ] **Step 1: Write the failing tests**

Create `workspace/src/x-nutrient-viewer/viewer-controller.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SDK_CDN_URL, ensureSdkLoaded, buildToolbar, hasSignature,
  saveToRecord, signDocument, loadTrustedCerts
} from './viewer-controller.js';

const fakeNutrient = {
  defaultToolbarItems: [{ type: 'zoom-in' }, { type: 'zoom-out' }],
  SignatureType: { CAdES: 'cades' },
  PAdESLevel: { b_lt: 'b-lt' }
};

test('SDK_CDN_URL pins version 1.17.0', () => {
  assert.match(SDK_CDN_URL, /pspdfkit-web@1\.17\.0\/nutrient-viewer\.js$/);
});

test('buildToolbar appends custom Save and Sign items', () => {
  const items = buildToolbar(fakeNutrient, { onSave: () => {}, onSign: () => {} });
  const ids = items.filter((i) => i.type === 'custom').map((i) => i.id);
  assert.deepEqual(ids, ['nutrient-save', 'nutrient-sign']);
  assert.equal(items.length, fakeNutrient.defaultToolbarItems.length + 2);
});

test('hasSignature true when signatures present', async () => {
  const instance = { getSignaturesInfo: async () => ({ signatures: [{}] }) };
  assert.equal(await hasSignature(instance), true);
});

test('hasSignature false when none', async () => {
  const instance = { getSignaturesInfo: async () => ({ signatures: [] }) };
  assert.equal(await hasSignature(instance), false);
});

test('saveToRecord exports then uploads the exported bytes', async () => {
  const calls = [];
  const instance = { exportPDF: async () => { calls.push('export'); return 'BYTES'; } };
  const uploadFn = async (buf) => { calls.push(`upload:${buf}`); };
  await saveToRecord(instance, uploadFn);
  assert.deepEqual(calls, ['export', 'upload:BYTES']);
});

test('signDocument mints token then signs with CAdES/b_lt and jwt', async () => {
  let signArgs = null;
  const instance = { signDocument: async (a, b) => { signArgs = [a, b]; } };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ accessToken: 'tok123', id: 'x' }) });
  await signDocument(instance, fakeNutrient, { signUrl: '/api/x/nutrient_dws_signing/sign', fetchImpl });
  assert.equal(signArgs[0].signingData.signatureType, 'cades');
  assert.equal(signArgs[0].signingData.padesLevel, 'b-lt');
  assert.deepEqual(signArgs[1], { jwt: 'tok123' });
});

test('signDocument throws endpoint error message on non-ok', async () => {
  const instance = { signDocument: async () => { throw new Error('should not be called'); } };
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'Rate limit exceeded' }) });
  await assert.rejects(
    () => signDocument(instance, fakeNutrient, { signUrl: '/x', fetchImpl }),
    /Rate limit exceeded/
  );
});

test('loadTrustedCerts returns certificates array', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ success: true, certificates: ['PEM1', 'PEM2'] }) });
  assert.deepEqual(await loadTrustedCerts('/certs', { fetchImpl }), ['PEM1', 'PEM2']);
});

test('loadTrustedCerts returns [] on failure', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  assert.deepEqual(await loadTrustedCerts('/certs', { fetchImpl }), []);
});

test('ensureSdkLoaded resolves existing global without touching DOM', async () => {
  const sdk = await ensureSdkLoaded('http://x', { getGlobal: () => fakeNutrient, doc: null });
  assert.equal(sdk, fakeNutrient);
});

test('ensureSdkLoaded injects a script when global absent', async () => {
  const appended = [];
  let loaded = false;
  const fakeScript = {
    setAttribute() {},
    addEventListener(evt, cb) { if (evt === 'load') { loaded = true; setImmediate(cb); } }
  };
  const doc = {
    querySelector: () => null,
    createElement: () => fakeScript,
    head: { appendChild: (s) => appended.push(s) }
  };
  let calls = 0;
  const getGlobal = () => (loaded && calls++ >= 0 ? fakeNutrient : null);
  const sdk = await ensureSdkLoaded('http://cdn/x.js', { getGlobal, doc });
  assert.equal(appended.length, 1);
  assert.equal(sdk, fakeNutrient);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test workspace/src/x-nutrient-viewer/`
Expected: FAIL — cannot resolve module `./viewer-controller.js` (not created yet).

- [ ] **Step 3: Implement `viewer-controller.js`**

Create `workspace/src/x-nutrient-viewer/viewer-controller.js`:

```javascript
/**
 * Framework-agnostic Nutrient viewer logic. No ServiceNow or snabbdom deps —
 * every external dependency (SDK global, fetch, document) is injectable so this
 * module is unit-testable under `node --test` and reusable in the local harness.
 */

export const SDK_CDN_URL = 'https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.17.0/nutrient-viewer.js';

/**
 * Ensure the Nutrient Web SDK UMD is loaded; resolves with the NutrientViewer global.
 */
export function ensureSdkLoaded(cdnUrl = SDK_CDN_URL, { doc = (typeof document !== 'undefined' ? document : null), getGlobal = () => (typeof window !== 'undefined' ? window.NutrientViewer : undefined) } = {}) {
  return new Promise((resolve, reject) => {
    const existingGlobal = getGlobal();
    if (existingGlobal) {
      resolve(existingGlobal);
      return;
    }
    if (!doc) {
      reject(new Error('No document available to load the Nutrient SDK'));
      return;
    }
    const onLoad = () => resolve(getGlobal());
    const onError = () => reject(new Error('Failed to load the Nutrient SDK script (check CSP trusted domains)'));

    const existingScript = doc.querySelector('script[data-nutrient-sdk]');
    if (existingScript) {
      existingScript.addEventListener('load', onLoad);
      existingScript.addEventListener('error', onError);
      return;
    }
    const script = doc.createElement('script');
    script.src = cdnUrl;
    script.setAttribute('data-nutrient-sdk', 'true');
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    doc.head.appendChild(script);
  });
}

/**
 * Build the toolbar: default items plus custom Save and Digitally Sign buttons.
 */
export function buildToolbar(NutrientViewer, { onSave, onSign }) {
  const items = NutrientViewer.defaultToolbarItems.slice();
  items.push({ type: 'custom', id: 'nutrient-save', title: 'Save', onPress: onSave });
  items.push({ type: 'custom', id: 'nutrient-sign', title: 'Digitally Sign', onPress: onSign });
  return items;
}

/**
 * Load a document into the container from an ArrayBuffer.
 */
export function loadDocument(NutrientViewer, { container, arrayBuffer, licenseKey, toolbarItems, trustedCAsCallback }) {
  return NutrientViewer.load({
    container,
    document: arrayBuffer,
    useCDN: true,
    licenseKey,
    toolbarItems,
    trustedCAsCallback
  });
}

/**
 * True if the document already contains at least one signature.
 */
export async function hasSignature(instance) {
  const info = await instance.getSignaturesInfo();
  return !!(info && info.signatures && info.signatures.length > 0);
}

/**
 * Export the current document and hand the bytes to uploadFn.
 * uploadFn is responsible for uploading and (only on success) deleting the original.
 */
export async function saveToRecord(instance, uploadFn) {
  const buffer = await instance.exportPDF();
  await uploadFn(buffer);
}

/**
 * Mint a DWS token from signUrl, then apply a CAdES / PAdES-b_lt signature.
 */
export async function signDocument(instance, NutrientViewer, { signUrl, expirationTime = 3600, fetchImpl = fetch }) {
  const res = await fetchImpl(signUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ expirationTime })
  });
  if (!res.ok) {
    let message = 'Signing service error';
    try {
      const body = await res.json();
      if (body && body.error) {
        message = body.error;
      }
    } catch (parseError) {
      // keep default message
    }
    throw new Error(message);
  }
  const data = await res.json();
  await instance.signDocument(
    {
      signingData: {
        signatureType: NutrientViewer.SignatureType.CAdES,
        padesLevel: NutrientViewer.PAdESLevel.b_lt
      }
    },
    { jwt: data.accessToken }
  );
}

/**
 * Fetch the active trusted CA PEMs for signature validation; [] on failure.
 */
export async function loadTrustedCerts(certsUrl, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(certsUrl, { credentials: 'same-origin' });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return (data && data.certificates) || [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test workspace/src/x-nutrient-viewer/`
Expected: all tests PASS (11 pass, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add workspace/src/x-nutrient-viewer/viewer-controller.js workspace/src/x-nutrient-viewer/viewer-controller.test.js
git commit -m "feat(workspace): add framework-agnostic viewer-controller with unit tests"
```

---

### Task 6: Implement the `x-nutrient-viewer` component shell and styles

Thin snabbdom component that wires ServiceNow lifecycle + properties to the controller. This uses JSX (the snabbdom renderer's syntax) and imports `@servicenow/ui-core`, so it is **verified at build time** (`snc ui-component develop`), not by `node --check` — documented in the README. Keep all non-trivial logic in the controller (Task 5); this file is glue only.

**Files:**
- Create: `workspace/src/x-nutrient-viewer/index.js`
- Create: `workspace/src/x-nutrient-viewer/styles.scss`

**Interfaces:**
- Consumes: all `viewer-controller.js` exports (Task 5); properties `attachmentId`, `table`, `recordId` (Task 4 manifest).
- Produces: registered custom element `x-nutrient-viewer`.

- [ ] **Step 1: Write `workspace/src/x-nutrient-viewer/styles.scss`**

```scss
:host {
  display: block;
  width: 100%;
  height: 100%;
}

.nv-root {
  width: 100%;
  height: 80vh;
  min-height: 480px;
}

.nv-error {
  padding: 16px;
  color: #b00020;
  font-family: inherit;
}
```

- [ ] **Step 2: Write `workspace/src/x-nutrient-viewer/index.js`**

```javascript
import { createCustomElement } from '@servicenow/ui-core';
import snabbdom from '@servicenow/ui-renderer-snabbdom';
import styles from './styles.scss';
import {
  ensureSdkLoaded, buildToolbar, loadDocument, hasSignature,
  saveToRecord, signDocument, loadTrustedCerts
} from './viewer-controller.js';

// License key is injected per-instance (domain-locked). Kept here to mirror the
// classic UI Page; a customer can move it to a system property + endpoint.
const LICENSE_KEY = '';

// Endpoints under the scoped service `nutrient_dws_signing`. `<ns>` is the scope
// namespace (glide.appcreator.company.code); resolve it via the page's base URL.
const nsPath = (ns) => `/api/${ns}/nutrient_dws_signing`;

const attachmentBinaryUrl = (attachmentId) =>
  `/sys_attachment.do?sys_id=${encodeURIComponent(attachmentId)}`;

async function mountViewer({ host, state, updateState, properties }) {
  const container = host.shadowRoot.querySelector('.nv-root');
  const ns = properties.namespace || '2169521';
  try {
    const NutrientViewer = await ensureSdkLoaded();

    const res = await fetch(attachmentBinaryUrl(properties.attachmentId), { credentials: 'same-origin' });
    if (!res.ok) {
      updateState({ error: 'Unable to load attachment — you may not have access.' });
      return;
    }
    const arrayBuffer = await res.arrayBuffer();
    const trustedCerts = await loadTrustedCerts(`${nsPath(ns)}/certificates`);

    const onSign = async () => {
      try {
        await signDocument(state.instance, NutrientViewer, { signUrl: `${nsPath(ns)}/sign` });
      } catch (e) {
        updateState({ error: `Signing failed: ${e.message}` });
      }
    };
    const onSave = async () => {
      if (await hasSignature(state.instance)) {
        return; // signed docs are read-only to preserve the signature (see README)
      }
      try {
        await saveToRecord(state.instance, async (buffer) => {
          const upload = await fetch(
            `/api/now/attachment/file?table_name=${encodeURIComponent(properties.table)}` +
            `&table_sys_id=${encodeURIComponent(properties.recordId)}` +
            `&file_name=signed-${Date.now()}.pdf`,
            { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf' }, body: buffer }
          );
          if (!upload.ok) {
            throw new Error('upload failed');
          }
          // delete original only after a confirmed successful upload
          await fetch(`/api/now/attachment/${encodeURIComponent(properties.attachmentId)}`, {
            method: 'DELETE', credentials: 'same-origin'
          });
        });
      } catch (e) {
        updateState({ error: `Save failed: ${e.message}` });
      }
    };

    const toolbarItems = buildToolbar(NutrientViewer, { onSave, onSign });
    const instance = await loadDocument(NutrientViewer, {
      container, arrayBuffer, licenseKey: LICENSE_KEY, toolbarItems,
      trustedCAsCallback: () => trustedCerts
    });
    updateState({ instance });
  } catch (e) {
    updateState({ error: `Viewer failed to load — verify CSP trusted domains. (${e.message})` });
  }
}

createCustomElement('x-nutrient-viewer', {
  renderer: { type: snabbdom },
  styles,
  properties: {
    attachmentId: { default: '' },
    table: { default: '' },
    recordId: { default: '' },
    namespace: { default: '2169521' }
  },
  initialState: { instance: null, error: '' },
  view: (state, { dispatch }) => {
    if (state.error) {
      return <div className="nv-error">{state.error}</div>;
    }
    return (
      <div
        className="nv-root"
        hook={{ insert: () => dispatch('NV#MOUNT') }}
      />
    );
  },
  actionHandlers: {
    'NV#MOUNT': (coeffects) => {
      const { host, state, updateState, properties } = coeffects;
      if (!properties.attachmentId) {
        updateState({ error: 'No attachment specified.' });
        return;
      }
      mountViewer({ host, state, updateState, properties });
    },
    'COMPONENT_DISCONNECTED': ({ state }) => {
      if (state.instance && typeof state.instance.destroy === 'function') {
        state.instance.destroy();
      }
    }
  }
});
```

- [ ] **Step 3: Verify the controller import surface matches**

This file cannot be `node --check`'d (JSX + bare-module imports). Instead verify the import names are all real exports of the controller:

Run: `node -e "import('./workspace/src/x-nutrient-viewer/viewer-controller.js').then(m => { for (const n of ['ensureSdkLoaded','buildToolbar','loadDocument','hasSignature','saveToRecord','signDocument','loadTrustedCerts']) { if (typeof m[n] !== 'function') throw new Error('missing '+n); } console.log('all imports resolve'); })"`
Expected: `all imports resolve`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add workspace/src/x-nutrient-viewer/index.js workspace/src/x-nutrient-viewer/styles.scss
git commit -m "feat(workspace): add x-nutrient-viewer component shell and styles"
```

---

### Task 7: Write the Workspace deployment runbook

Replace the stub `workspace/README.md` with a complete deploy + validation guide. This is a primary deliverable for a reference implementation.

**Files:**
- Modify: `workspace/README.md` (full rewrite)

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `workspace/README.md`**

Content MUST include these sections with the specifics below:

1. **Overview** — what this is (Workspace-native full-parity viewer), and that the classic build stays frozen.
2. **Prerequisites** — Node LTS (20+), `npm i -g @servicenow/cli`, `snc extension add --name ui-component`, an instance login (`snc configure profile` / `now.config.json`), `nutrient_user` role, a domain-valid Nutrient license key, the DWS API token in system property `nutrient.dws.api.token`.
3. **Server layer setup** — import/confirm the three `shared/` Scripted REST resources (`/sign`, `/metadata`, `/certificates`) under service `nutrient_dws_signing`; enable **ECMAScript 2021 mode** on each resource and on the Script Include; role-gate all three (`nutrient_user`|`admin`) incl. the mandatory REST_Endpoint ACL; upload the 3 GlobalSign CA PEMs from `shared/certificates/` as **separate** active `sys_certificate` records.
4. **Set the license key** — put the domain-valid key in `LICENSE_KEY` in `index.js` (and note the customer-extension option: serve it from a property via an endpoint).
5. **Build & deploy the component** — `snc ui-component develop` (local), `snc ui-component deploy` (to instance); reconcile the hand-authored `now-ui.json`/`now.config.json` with what the CLI generates for your release.
6. **Place + launch in UI Builder** — add `x-nutrient-viewer` to the record page; create a **per-attachment declarative action** ("Open in Nutrient"); wire its event to an **"Open modal" (Custom type)** handler hosting the component, binding `attachmentId`/`table`/`recordId` from the action payload.
7. **CSP configuration** (Security Center → Content Security Policy / CSP system properties, needs security admin): add `https://cdn.cloud.pspdfkit.com` to `script-src` and `connect-src`; add `https://api.nutrient.io` to `connect-src`; add `'wasm-unsafe-eval'` to `script-src`; add `blob:` to `worker-src` and `child-src`. Document the **instance-hosted-assets alternative** (host SDK + WASM in the instance, set SDK `baseUrl` to the instance origin) to avoid CDN in CSP.
8. **Sign-then-save limitation** — Save is disabled once a document is signed (exportPDF re-serialization breaks the signature); documented as intended behavior.
9. **On-instance validation checklist** — as a `nutrient_user` non-admin: open an attachment via the action → viewer renders; annotate; Save (unsigned) → new PDF replaces original; Digitally Sign → green/valid signature (with CA chain uploaded); confirm Save is disabled after signing.
10. **Open items to validate on deploy** — exact CSP config surface; attachment-action payload field names; lifecycle action timing (`COMPONENT_CONNECTED` vs render `insert` hook); client-generated-scripts sandbox; confirm Nutrient's current CSP directive list against the Nutrient Web SDK docs.

- [ ] **Step 2: Verify no leftover stub content and internal links resolve**

Run: `grep -n "not yet built\|not started" workspace/README.md; echo "exit: $?"`
Expected: no matches (grep exit 1 → prints `exit: 1`).

- [ ] **Step 3: Commit**

```bash
git add workspace/README.md
git commit -m "docs(workspace): full deploy runbook + on-instance validation checklist"
```

---

### Task 8: Final verification pass and memory update

**Files:**
- Modify: `/Users/jonaddamsnutrient/.claude/projects/-Volumes-code-servicenow/memory/resume-next-steps.md`
- Modify: `/Users/jonaddamsnutrient/.claude/projects/-Volumes-code-servicenow/memory/MEMORY.md` (if a new pointer is warranted)

**Interfaces:** none.

- [ ] **Step 1: Run the full static + unit verification**

Run:
```bash
node --check "shared/Script Include - NutrientAttachmentHelper.js" && \
node --check "shared/Script Rest API - metadata.js" && \
node --check "shared/Script Rest API - certificates.js" && \
node --test workspace/src/x-nutrient-viewer/ && \
grep -RnE "PSPDFKit\.|PAdESLevel\.bLt|\bvar \b" workspace/src shared/*metadata* shared/*certificates* || echo "no forbidden tokens"
```
Expected: all `node --check` silent (exit 0); `node --test` all pass; the final grep prints `no forbidden tokens` (no `PSPDFKit.` global, no `PAdESLevel.bLt` typo, no stray `var`).

- [ ] **Step 2: Confirm signing tokens are consistent across layers by inspection**

Verify: `viewer-controller.js` `signDocument` reads `data.accessToken`; `shared/Script Rest API - Nutrient DWS API - sign.js` returns `accessToken` in its success body. Confirm `CAdES` + `PAdESLevel.b_lt` appear in the controller.

- [ ] **Step 3: Update the resume memory**

Update `resume-next-steps.md`: mark Phase 2 as "implemented (reference implementation, not yet deployed live)"; record the new endpoints (`/metadata`, `/certificates`), the component location (`workspace/src/x-nutrient-viewer/`), the plan/spec paths, and the remaining on-instance validation items from Task 7 Step 1 §10.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: Phase 2 verification pass; update resume memory"
```

---

## Notes for the executor

- **No live ServiceNow instance in this environment.** ServiceNow server scripts and the JSX component are verified by `node --check` / import-surface checks and a documented on-instance checklist — do NOT claim the ServiceNow runtime glue (declarative action, modal, CSP) is verified. Only `viewer-controller.js` is unit-tested.
- **`node --check` on server files parses only** — undefined globals (`GlideRecord`, `gs`, `sn_ws`, `request`, `response`) are expected and fine.
- Attachment upload/delete uses the Table Attachment API (`/api/now/attachment/...`); confirm the exact multipart vs raw-body form your release expects during on-instance validation (noted in README §9).
