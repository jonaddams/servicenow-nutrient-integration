# Workspace client — deployment runbook

## 1. Overview

Workspace-native front end for the ServiceNow ↔ Nutrient Web SDK integration: a
UX Framework (Now Experience / Seismic) custom component, `x-nutrient-viewer`,
that opens a record attachment in the Nutrient Web SDK inside **Agent
Workspace / Service Operations Workspace** — view, annotate, save, and
digitally sign, at parity with the classic build.

It exists because the [`classic-ui/`](../classic-ui) client (a `client
script` + DOM interception on `/sys_attachment.do` links) only runs in the
classic Platform UI. Workspace has no such link in the DOM and routes
attachment clicks through its own native preview, so this integration needed
a Workspace-native component instead of a config tweak. **The classic build
is complete and stays frozen** — this is a parallel client that reuses the
[`shared/`](../shared) server layer unchanged.

### Directory layout

```
workspace/
├── now.config.json                     # snc CLI target: which component(s) to build
├── package.json                        # develop/deploy scripts, ui-core + snabbdom deps
└── src/x-nutrient-viewer/
    ├── now-ui.json                     # UI Builder metadata: properties, icon, associated types
    ├── index.js                        # the component: mount/render/action-handler wiring
    ├── viewer-controller.js            # framework-agnostic SDK load/sign/save logic (unit-tested)
    ├── viewer-controller.test.js       # node --test coverage for viewer-controller.js
    └── styles.scss
```

The component declares four properties (`src/x-nutrient-viewer/now-ui.json`):
`attachmentId`, `table`, `recordId` (all plain strings, no default), and
`namespace` (defaults to `"2169521"` — override per instance, see §6).

## 2. Prerequisites

| What | Notes |
|---|---|
| Node.js LTS (20+) | Required by `@servicenow/cli`. |
| `@servicenow/cli` | `npm i -g @servicenow/cli` |
| The `ui-component` CLI extension | `snc extension add --name ui-component` — adds the `snc ui-component *` commands used below. |
| An instance login | `snc configure profile` (interactively creates/updates a CLI profile); this repo already ships a hand-authored [`now.config.json`](./now.config.json) targeting the `x-nutrient-viewer` component — point your profile at the target instance before building. |
| `nutrient_user` role | Must exist and be assigned to any non-admin test user; created as part of the shared server layer deployment (see §3). |
| A domain-valid Nutrient Web SDK license key | Must cover the instance host (e.g. `devXXXXX.service-now.com`), or the viewer watermarks and signatures show as tampered. |
| The Nutrient DWS API token | Stored in the system property `nutrient.dws.api.token` (server-side only — see [`shared/README.md`](../shared/README.md)). |
| The shared server layer already deployed | See §3 — deploy it once per instance, before this client. |

## 3. Server layer setup

Deploy [`shared/`](../shared) first if it isn't already on the instance (it's
shared with the classic build and is not workspace-specific):

1. **Script Include** — `shared/Script Include - NutrientAttachmentHelper.js`
   (client-callable). Returns attachment metadata and the trusted CA chain
   server-side; used internally by the `/metadata` and `/certificates`
   resources below.
2. **Scripted REST API** `Nutrient DWS API`, API ID `nutrient_dws_signing`,
   with three resources (all under `/api/<namespace>/nutrient_dws_signing/…`):
   - `POST /sign` — `shared/Script Rest API - Nutrient DWS API - sign.js`. Mints a
     short-lived, origin-scoped DWS signing token from the
     `nutrient.dws.api.token` property.
   - `GET /metadata` — `shared/Script Rest API - metadata.js`. Attachment
     metadata for the Workspace client (which has no GlideAjax); thin wrapper
     over the Script Include.
   - `GET /certificates` — `shared/Script Rest API - certificates.js`. Active
     trusted CA PEMs for `trustedCAsCallback`; also GlideAjax-free.

   **Enable "ECMAScript 2021 mode"** on all three Scripted REST resources
   *and* on the Script Include — they use `const`/`let`, template literals,
   and arrow functions. If left off, expect the sign/metadata/certificates
   calls to fail (commonly surfacing as HTTP 500).

3. **Role-gate all three resources** to `nutrient_user` | `admin`. Each
   script already checks `gs.hasRole('nutrient_user') || gs.hasRole('admin')`
   and returns 403 otherwise, but that in-script check is not a substitute
   for the platform ACL — without it, non-admin requests never reach the
   script. Add a `REST_Endpoint` ACL on the API (or on each resource) with
   `admin` and `nutrient_user` in its required roles, same pattern as the
   classic build's `/api/*` (`http_post`) `REST_Endpoint` ACL.

4. **Upload the CA chain.** Under `sys_certificate.list` (System Definition →
   Certificates), create three **separate** Active, PEM-format records from
   `shared/certificates/`:
   - `nutrient-dws-ca-1-atlas-r45-aatl-ca-2020.pem` (intermediate)
   - `nutrient-dws-ca-2-r45-aatl-root-ca-2020.pem` (intermediate)
   - `nutrient-dws-ca-3-document-signing-root-r45.pem` (root anchor)

   Paste one certificate per record — **do not** use the combined
   `nutrient-dws-ca-chain.pem` file, and don't concatenate PEMs into a single
   record. These chain the DWS signer to a publicly-trusted, AATL root, so
   signatures validate as genuinely valid rather than self-signed or
   untrusted. No end user needs `sys_certificate` read access — the
   certificates are served through `/certificates` above.

## 4. Set the license key

Put the domain-valid Nutrient Web SDK license key in the `LICENSE_KEY`
constant near the top of `src/x-nutrient-viewer/index.js`:

```js
const LICENSE_KEY = '';
```

It's checked in as an empty string. This mirrors the classic UI Page (which
also hardcodes the key), and has the same trade-off: it ends up in the
component bundle shipped to the instance. For a customer-facing extension,
move it to a system property and serve it through an endpoint (e.g. add a
field to the `/metadata` response, or a small dedicated resource) so it's
never checked into source or bundled client-side.

## 5. Build & deploy the component

```bash
snc ui-component develop   # local dev server against now.config.json's profile — fast iteration loop
snc ui-component deploy    # pushes the component to the configured instance
```

Both are also exposed as `npm run develop` / `npm run deploy` in
[`package.json`](./package.json).

`now-ui.json` and `now.config.json` in this repo are **hand-authored**, not
CLI-generated — they were written to match the properties and lifecycle the
component actually uses. The `snc ui-component` toolchain normally scaffolds
and can rewrite these files for a given CLI/release combination, so on first
deploy diff what the CLI produces (or wants to produce) against what's
checked in here before overwriting either — reconcile rather than blindly
accept one side.

## 6. Place and launch in UI Builder

1. In UI Builder, add **Nutrient PDF Viewer** (`x-nutrient-viewer`, icon
   `document-outline`, associated with `global.core` and `record.page` per
   `now-ui.json`) to the target record page.
2. This component is attachment-scoped, not auto-wired to the current
   record — it needs `attachmentId`, `table`, and `recordId` bound from
   somewhere. The intended trigger is a **per-attachment declarative
   action**, e.g. "Open in Nutrient", surfaced on the attachment list/related
   list item in Workspace.
3. Wire that action's event to an **"Open modal" (Custom type)** UI Builder
   event handler that hosts `x-nutrient-viewer`, binding its `attachmentId`,
   `table`, and `recordId` properties from the declarative action's payload.
4. Set the `namespace` property to the instance's actual scope namespace
   (`glide.appcreator.company.code` in `sys_properties.list`) — it defaults
   to `"2169521"` in `now-ui.json`, which is almost certainly not your
   instance's code.

The exact payload field names the declarative action exposes, and whether
"Open modal (Custom)" is the right handler type for the target release, are
flagged as on-instance validation items in §10.

## 7. CSP configuration

> Needs `security_admin` (or equivalent). The exact configuration surface —
> **Security Center → Content Security Policy** vs. the older CSP system
> properties (`glide.security.csp.*` / Trusted Domains) — varies by release;
> confirm which applies on the target instance (§10).

Add, or confirm already present from the classic build:

| Directive | Value | Why |
|---|---|---|
| `script-src` | `https://cdn.cloud.pspdfkit.com` | `viewer-controller.js` loads the SDK UMD bundle from this CDN (`SDK_CDN_URL`, pinned to `pspdfkit-web@1.17.0`). |
| `connect-src` | `https://cdn.cloud.pspdfkit.com` | The SDK fetches its WASM/asset bundle from the same host after the script loads. |
| `connect-src` | `https://api.nutrient.io` | `instance.signDocument(...)` calls out to the Nutrient DWS signing service directly from the browser using the short-lived JWT minted by `/sign`. |
| `script-src` | `'wasm-unsafe-eval'` | Needed to instantiate the SDK's WebAssembly module. |
| `worker-src` | `blob:` | The SDK spins up its rendering/processing work in workers instantiated from `blob:` URLs. |
| `child-src` | `blob:` | Same reason as `worker-src`, for browsers/CSP levels that key off `child-src` instead. |

**Instance-hosted-assets alternative:** to avoid adding
`cdn.cloud.pspdfkit.com` to CSP at all, host the SDK JS + WASM assets on the
instance itself (e.g. as attachments/UI Scripts served from the instance
origin) and point the SDK at them via its `baseUrl` config option instead of
`useCDN: true` (set in `viewer-controller.js`'s `loadDocument`). You'd still
need `'wasm-unsafe-eval'`, the `blob:` worker directives, and `connect-src`
for `api.nutrient.io` if signing is in use — only the CDN entries are
avoidable this way.

## 8. Sign-then-save limitation

Once a document is signed, **Save is disabled** — this is intended behavior,
not a bug. `index.js`'s `onSave` handler calls `hasSignature(instance)`
before doing anything else; if the document already has a signature, it sets
a banner ("Save is disabled for a signed document to preserve its
signature.") and returns without exporting. The reason: `exportPDF()`
re-serializes the document, which rewrites the underlying bytes and
invalidates the existing CAdES/PAdES signature's byte range — the same
limitation documented for the classic build. Treat signing and "save as PDF"
as mutually exclusive per document.

## 9. On-instance validation checklist

Run this as a **non-admin** user with only `nutrient_user` (impersonate or
log in directly) — the same access a real fulfiller would have:

- [ ] Open a record with an attachment; trigger the "Open in Nutrient"
      action → the modal opens and the viewer renders the document.
- [ ] Annotate the document.
- [ ] Press **Save** (unsigned) → the original attachment is replaced by a
      new PDF (POST to `/api/now/attachment/file`, then the original is
      deleted only after the upload succeeds).
- [ ] Press **Digitally Sign** → the signature reports valid (green), which
      requires all three CA certs from §3 to be uploaded and Active.
- [ ] After signing, confirm **Save is disabled** and shows the banner from
      §8 rather than silently no-oping or corrupting the document.

## 10. Open items to validate on deploy

These depend on the target instance/release and weren't fully resolvable
without one to test against:

- **Exact CSP configuration surface** — Security Center UI vs. CSP system
  properties vs. Trusted Domains, depending on release (§7).
- **Attachment-action payload field names** — confirm the actual field names
  the declarative action's payload exposes for attachment sys_id, table, and
  parent record sys_id, and that they map cleanly onto `attachmentId` /
  `table` / `recordId`.
- **Lifecycle action timing** — `index.js` mounts the viewer from the
  render-hook `insert` callback (`hook={{ insert: () => dispatch('NV#MOUNT') }}`)
  rather than from a `COMPONENT_CONNECTED` action handler. Confirm this is
  the reliable mount point for the target release, since UX Framework
  lifecycle guidance has shifted across releases.
- **Client-generated-scripts sandbox** — `ensureSdkLoaded()` in
  `viewer-controller.js` injects a `<script>` tag via
  `document.createElement('script')` / `appendChild`. UX Framework components
  can run in a more restricted script-injection context than classic UI
  Pages; confirm this isn't blocked on the target instance.
- **Nutrient's current CSP directive list** — the SDK version here is pinned
  to `pspdfkit-web@1.17.0`; cross-check the directives in §7 against the
  current Nutrient Web SDK documentation before go-live, in case newer SDK
  releases changed CSP requirements.
