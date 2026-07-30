# Workspace (UXF) client — deployment guide

The client for **Agent / Service Operations Workspace** (Next Experience / UXF).
An **Open in Nutrient** button on a record opens the Nutrient viewer in a modal
to view, annotate, save, and digitally sign — resolving the record's PDF
dynamically. Verified end‑to‑end on a live instance.

← Back to the [project overview](../README.md).

> **Prerequisite:** deploy the [shared server layer](../shared/README.md)
> **first** — including the two Workspace‑only REST resources (`GET /metadata`
> and `GET /certificates`) and the `http_get` `REST_Endpoint` ACL. This guide
> assumes those, the DWS token, certificates, and the `nutrient_user` role are
> already in place.

## 1. Overview

Workspace-native front end for the ServiceNow ↔ Nutrient Web SDK integration: a
UX Framework (Now Experience / Seismic) custom component,
**`x-2169521-nutrient-viewer`**, that opens a record's PDF attachment in the
Nutrient Web SDK inside **Agent Workspace / Service Operations Workspace** —
view, annotate, save, and digitally sign, at parity with the classic build.

It exists because the [`classic-ui/`](../classic-ui) client (a `client script`
+ DOM interception on `/sys_attachment.do` links) only runs in the classic
Platform UI. Workspace has no such link in the DOM and routes attachment clicks
through its own native preview, so this integration needed a Workspace-native
component instead of a config tweak. **The classic build is complete and stays
frozen** — this is a parallel client that reuses the [`shared/`](../shared)
server layer unchanged.

> **Component tag name / vendor prefix.** The instance rejects custom component
> tags that don't start with its vendor prefix `x-<companycode>-`. On the dev
> instance the company code (`glide.appcreator.company.code`) is `2169521`, so
> the tag is `x-2169521-nutrient-viewer`. **On a different instance, rename the
> tag** to `x-<thatcompanycode>-nutrient-viewer` (in `index.js`
> `createCustomElement(...)`, both `now-ui.json` files, and `now.config.json`).

### Directory layout

```
workspace/
├── now.config.json                     # snc CLI target: which component(s) to build
├── now-ui.json                         # ROOT manifest the CLI reads: scopeName + components
├── package.json                        # main/module entry + develop/deploy scripts + deps
└── src/x-nutrient-viewer/              # (dir name kept; component TAG is x-2169521-nutrient-viewer)
    ├── now-ui.json                     # per-component metadata (properties, icon, associated types)
    ├── index.js                        # the component: mount/render/action-handler wiring
    ├── viewer-controller.js            # framework-agnostic SDK load/sign/save logic (unit-tested)
    ├── viewer-controller.test.js       # node --test coverage (31 tests)
    └── styles.scss
```

The component declares four properties (`now-ui.json`): `attachmentId`, `table`,
`recordId`, and `namespace` (defaults to `"2169521"` — override per instance).
Launched record-level, it reads `table`/`recordId` from its own URL query params
(see §6) and finds the record's PDFs itself; `attachmentId` is optional (used only
if you launch it for one specific attachment).

**Which document opens**, in precedence order:

1. the one the user picked in the attachment picker (below);
2. `?attachmentId=` on the URL, if the launcher pins one;
3. the static `attachmentId` property (ignored once a URL record context is
   present, so one page can serve any record);
4. otherwise the record's PDFs are listed — **one** opens directly, **several**
   show a picker, **none** shows "No PDF attachment found on this record."

The picker exists because the action-bar launcher carries no attachment
identity: ServiceNow's stock Attachments sidebar does not expose which row the
user highlighted (see §6), so with multiple PDFs the component asks rather than
guessing. Each choice is labelled with filename, size, and upload date.

## 2. Prerequisites

| What | Notes |
|---|---|
| Node.js LTS (20+) | For the local dev/test tooling. |
| **ServiceNow CLI (`snc`)** | Download the installer from **github.com/ServiceNow/servicenow-cli/releases/latest** (`snc-x.y.z.zip` → per-OS installer). This is the credential-free route (PDIs can't reach the Store). Installs `snc` (macOS: `/Applications/ServiceNow CLI/bin/snc`) and `~/.snc`. Verify: `snc --version`. **Note:** the npm `@servicenow/cli` package is only a launcher (`now-cli`) and errors "SNC is not found" — use the GitHub installer. |
| `ui-component` CLI extension | `snc extension add --name ui-component` — adds the `snc ui-component *` commands. (If the npm install left root-owned files in `~/.npm`, `sudo chown -R $(id -u):$(id -g) ~/.npm` first.) |
| An instance profile | `snc configure profile set` — interactive: Host `https://devXXXXX.service-now.com`, Login method `Basic`, admin user/pass (creds go to the OS keychain). |
| `npm install` in `workspace/` | Fetches `@servicenow/ui-core`, the snabbdom renderer, and build tooling. |
| `nutrient_user` role | Created with the shared server layer (see §3); assign to any non-admin test user. |
| A domain-valid Nutrient Web SDK license key | Must cover the instance host, else the viewer watermarks and signatures validate as tampered. See §4. |
| The Nutrient DWS API token | System property `nutrient.dws.api.token` (server-side only — see [`shared/README.md`](../shared/README.md)). |
| The shared server layer deployed | See §3 — once per instance, before this client. |

## 3. Server layer setup

Deploy [`shared/`](../shared) first if not already present (shared with the
classic build):

1. **Script Include** — `shared/Script Include - NutrientAttachmentHelper.js`
   (client-callable). Exposes `getAttachmentDetails(sysId)` and
   `getTrustedCertificatesData()` (used by the REST resources below) plus the
   classic GlideAjax wrappers. **If an older classic-only version is already on
   the instance, redeploy this file** — it must have the two new methods or the
   `/metadata` and `/certificates` calls 500.
2. **Scripted REST API** `Nutrient DWS API`, API ID `nutrient_dws_signing`,
   three resources under `/api/<namespace>/nutrient_dws_signing/…`:
   - `POST /sign` — `shared/Script Rest API - Nutrient DWS API - sign.js`.
   - `GET /metadata` — `shared/Script Rest API - metadata.js`.
   - `GET /certificates` — `shared/Script Rest API - certificates.js`.

   **Enable "ECMAScript 2021 mode"** on all three resources *and* the Script
   Include (they use `const`/`let`, template literals, arrow functions). If off,
   calls 500 with an empty body and **no** `sys_log` entry (a compile failure).
3. **Role-gate the resources** to `nutrient_user` | `admin`. Each script also
   checks the role in-script (403 otherwise). On this instance the existing
   `/api/*` `http_post` `REST_Endpoint` ACL + admin-overrides covered the GET
   resources for admin testing; add an `http_get` `REST_Endpoint` ACL (Name
   `/api/*`, roles `nutrient_user`+`admin`) if a non-admin gets 403 on GET.
4. **Upload the CA chain** — three **separate** Active PEM records under
   `sys_certificate` from `shared/certificates/` (do **not** concatenate):
   `…ca-1-atlas-r45-aatl-ca-2020.pem`, `…ca-2-r45-aatl-root-ca-2020.pem`,
   `…ca-3-document-signing-root-r45.pem`. These make signatures validate as
   trusted (AATL root) rather than untrusted. Served via `/certificates`; no end
   user needs `sys_certificate` access.

## 4. Set the license key (local only — never commit)

`LICENSE_KEY` at the top of `src/x-nutrient-viewer/index.js` is checked in as
`''`. Inject the domain-valid key **locally** before deploying, and **revert to
`''` before committing** — it must not enter git history:

1. Open `src/x-nutrient-viewer/index.js`.
2. Find line ~12: `const LICENSE_KEY = '';`
3. Paste your key between the quotes and save.
4. Deploy (§5).
5. **Change it back to `''`** as soon as the deploy finishes.

Confirm nothing is staged before you commit:

```bash
git diff | grep "LICENSE_KEY = '[^']"   # must print nothing
```

It ends up in the component bundle shipped to the instance (same trade-off as
the classic UI Page). For a customer-facing extension, move it to a system
property served through an endpoint so it's never bundled client-side. A
security scan will (correctly) flag a hardcoded key — keep it local-only.

## 5. Build & deploy the component

```bash
npm install                         # once
snc ui-component deploy --force     # build + validate + push (use --force to overwrite an existing component)
# snc ui-component develop          # optional local dev server (needs an example/ entry)
```

Also exposed as `npm run deploy` in [`package.json`](./package.json).

**Deploy config that must be right (all already set in this repo):**
- `package.json` needs `"main"` + `"module"` pointing at
  `src/x-nutrient-viewer/index.js` (the CLI needs an entry).
- **`now-ui.json` must be at the project root** (`workspace/now-ui.json`), with
  a top-level `"scopeName"` and `"components"`. (The per-component
  `src/x-nutrient-viewer/now-ui.json` is vestigial.)
- **`scopeName`** must use the vendor prefix, not the reserved `sn_` (e.g.
  `x_2169521_nutrient`, ≤18 chars). The deploy creates this scoped app.
- Component **tag** must start with `x-<companycode>-` (see §1 callout).

## 6. Launch UX — record action → modal (as shipped)

The per-individual-attachment "⋮" menu on the stock Workspace attachments
component is **not** extensible (hard-coded Download/Delete). So the viewer is
launched from a **record action bar button**. That button is record-level — it
cannot see which attachment is selected in the sidebar — so the component lists
the record's PDFs and offers a picker when there is more than one (§1).

What's deployed on the dev instance:

1. **A declarative action** (`sys_declarative_action_assignment`) on `incident`:
   - `model = Form`, `form_position = action_bar`,
     `declarative_action_type = Client Script`, label **"Open in Nutrient"**.
   - **`client_script`** `onClick` reads the record via `g_form` and opens a
     Next-Experience modal via `g_modal.showFrame`, passing the record context
     as URL params:
     ```js
     function onClick() {
       var sysId = g_form.getUniqueValue();
       var table = g_form.getTableName();
       g_modal.showFrame({
         url: '/now/nutrient/nutrient?table=' + encodeURIComponent(table) +
              '&recordId=' + encodeURIComponent(sysId),
         title: 'Nutrient PDF Viewer',
         size: 'fw'            // full-window; 'lg'/'xl' also valid, plus a height param
       });
     }
     ```
   - **Targeting gotchas (these decide whether it renders in Workspace):**
     - Leave the **`view`** field EMPTY (that field is a *classic* form view).
       Target the workspace via **`scripted_client_condition`** =
       `"{{view}}" == "sow" || "{{view}}" == "aitsm"`.
     - Set **`required_user_role_names`** = `itil,sn_incident_write` (an empty
       value defaults to `snc_internal`, which can hide the action).
     - For a **global-scope** action, set **`enable_for_all_experiences = true`**
       — otherwise SOW only loads actions from its own app scopes and the button
       never appears. (This was the final missing piece.)
   - After creating/editing the action, run `/cache.do` and hard-refresh; the
     declarative-action set is cached.

2. **A destination page** — `/now/nutrient/nutrient` (a small UX experience)
   hosts `x-2169521-nutrient-viewer`. `g_modal.showFrame` iframes it. The
   component reads `?table` / `?recordId` (and optionally `?attachmentId`) from
   that URL (`urlContext()` in `index.js`), overriding any static page props, and
   lists the record's PDFs via `listPdfAttachments()` → the `/certificates` +
   `/sign` endpoints do the rest. One page serves any record.

> **Known cosmetic gap (accepted):** iframing a full UX experience also renders
> that experience's app-shell nav as a thin strip inside the modal. Full-window
> (`size:'fw'`) minimizes it. Truly chromeless is **not** a simple swap — the
> shell (`root_macroponent` on the experience's `sys_ux_page_registry` row) is
> locked by the platform business rule **"Prevent app shell ui update"** (403 on
> any change, even elevated). To go chromeless you'd have to **create a new
> experience born with a blank shell** (e.g. `UIB Blank AppShell`; inserts aren't
> blocked) and point `g_modal.showFrame` at it, **or** point it at a bare classic
> UI Page (trades the UXF component for the classic viewer). Left as-is by choice.

Alternative (not used): a native `RECORD#OPEN_MODAL` route rendering the
component directly — more "correct" but a multi-record UX build (route +
screen + event mapping); `g_modal.showFrame` was chosen for reliability.

## 7. CSP configuration

On the dev instance **no CSP changes were needed** — the SDK loaded from the CDN
and signed successfully out of the box (the classic build's CSP entries, if
present, already cover it; some releases allow the CDN by default). If the viewer
fails to load on a stricter instance (`Refused to load` / `wasm` errors in the
console), add/confirm these (needs `security_admin`; the surface is **Security
Center → Content Security Policy** or the older `glide.security.csp.*` /
Trusted Domains, by release):

| Directive | Value | Why |
|---|---|---|
| `script-src` | `https://cdn.cloud.pspdfkit.com` | SDK UMD bundle (`SDK_CDN_URL`, `pspdfkit-web@1.17.0`). |
| `connect-src` | `https://cdn.cloud.pspdfkit.com` | SDK WASM/asset fetch (assets resolve from `cdn.cloud.nutrient.io` too). |
| `connect-src` | `https://api.nutrient.io` | `instance.signDocument(...)` calls DWS from the browser with the `/sign` JWT. |
| `script-src` | `'wasm-unsafe-eval'` | Instantiate the SDK's WASM. |
| `worker-src` / `child-src` | `blob:` | SDK workers from `blob:` URLs. |

## 8. Save behaviour

### Sign-then-save limitation

Once signed, **Save is disabled** (intended). `onSave` calls
`hasSignature(instance)` first and, if signed, shows a banner and returns
without exporting — `exportPDF()` re-serializes the bytes and would invalidate
the CAdES/PAdES byte-range signature. Signing and save-as-PDF are mutually
exclusive per document (same as classic).

### Feedback

Save reports its outcome in a banner above the viewer, because
`exportPDF()` + upload has no progress indicator of its own:

| State | Banner |
|---|---|
| In flight | *"Saving to the record…"* (blue) |
| Success | *"Saved to the record as `saved-<timestamp>.pdf`."* (green) |
| Failure | *"Save failed: …"* (red), including the HTTP status on an upload error |
| Blocked | *"Save is disabled for a signed document…"* (red) — see above |

Save replaces the attachment: it uploads the exported PDF, then deletes the
original **only after** the upload succeeds. The component then re-points at the
newly created attachment, so a second Save replaces that file rather than adding
another copy. A concurrent second click while a save is in flight is ignored.

## 9. Validation status

### Confirmed live on the dev instance, as admin (2026-07)

- ✅ Record → **"Open in Nutrient"** (action bar) → full-window modal → viewer
  renders the record's PDF.
- ✅ **Dynamic per-record**: INC0010002 → its PDF; a record with no PDF →
  "No PDF attachment found on this record" (proves it's not hard-coded).
- ✅ **Digitally Sign** → `getSignaturesInfo()` reports
  `status: 'valid', certificateChainValidationStatus: 'ok', isTrusted: true`
  (green) with the three CA certs uploaded.
- ✅ Save (unsigned) replaces the attachment; Save disabled after signing (§8).

### Deployed but NOT yet clicked through by a human (2026-07-30)

The attachment picker and the Save feedback banners are deployed and unit-tested,
and the component compiled clean, but nobody has confirmed them in a browser:

- ⬜ **Multiple PDFs on one record** → picker lists both; choosing the *older* one
  opens **that** document (previously the newest always won).
- ⬜ **Save banners** → in-flight, then green success naming `saved-<ts>.pdf`.
- ⬜ **Second Save** replaces `saved-<ts>.pdf` rather than adding another copy.

### Never run: non-admin pass

The whole Workspace flow has **only ever been exercised as admin.** Run §11 as a
non-admin `nutrient_user` before any customer demo. Note the picker added a
`sys_attachment` **Table API read** — if a non-admin can't query it they'll see
"No PDF attachment found" instead of the picker.

## 10. Notes / residual items

- **Chromeless modal** (§6 callout) — the nested app-shell nav strip; cosmetic,
  accepted as-is. Changing an existing experience's shell is blocked by the
  "Prevent app shell ui update" business rule; chromeless would need a new
  blank-shell experience or the classic bare viewer.
- **Client-side caching** — declarative-action and UX metadata are cached; after
  server-side changes run `/cache.do` + hard refresh. Avoid nuking the SOW app's
  IndexedDB/localStorage/service-worker — it breaks the app-shell bootstrap.
- **Per-instance rename** — component tag prefix, `scopeName`, and the
  `namespace` property all encode the company code `2169521`; change them for a
  different instance (§1).
- **Signature level** — signatures came back PAdES `b-t` though `b_lt` is
  requested; valid + trusted regardless. Revisit only if long-term-validation
  (embedded revocation) is a hard requirement.

## 11. Test checklist (for a reviewing SE)

Work top to bottom. Each step says what you should see; if it differs, the
**Likely cause** column is where to look first. Test as **admin** first, then
repeat the whole list impersonating a non-admin with `itil` + `nutrient_user`.

**Setup:** an OPEN incident (the attachment paperclip is hidden on
Closed/Resolved records) with **two** PDFs attached, uploaded a few minutes
apart so "newest" is unambiguous. On the dev instance: **INC0010002**.

| # | Do this | Expect | Likely cause if it differs |
|---|---|---|---|
| 1 | Open the incident in Service Operations Workspace | Record loads with an **Open in Nutrient** button in the action bar | Button missing → run `/cache.do`, hard-refresh; then check `enable_for_all_experiences = true` and `scripted_client_condition` (§6) |
| 2 | Click **Open in Nutrient** | Full-window modal opens | `g_modal` undefined → the declarative action isn't a Client Script type (§6) |
| 3 | — | A **picker** lists both PDFs with filename, size, date | Straight to a viewer → only one PDF is a `content_type` matching `pdf`; "No PDF attachment found" → `sys_attachment` read denied (non-admin) |
| 4 | Click the **older** PDF | **That** document renders (not the newest) | Wrong doc → the deployed bundle is stale; redeploy (§5) + hard-refresh |
| 5 | — | Full toolbar, no watermark | Watermark → license key missing or not valid for this host (§4) |
| 6 | Annotate something (highlight or comment) | Annotation appears | — |
| 7 | Click **Save** | Blue *"Saving to the record…"*, then green *"Saved to the record as `saved-<ts>.pdf`"* | Red banner → read the message; 401 → `X-UserToken` / session; 403 → `nutrient_user` ACLs (shared §6) |
| 8 | Close the modal, check the record's attachments | Original replaced by `saved-<ts>.pdf`; annotation is in it | Both files present → the delete failed (the banner would have said so) |
| 9 | Reopen, **Save** again | Green banner; still exactly one `saved-*.pdf` (a *newer* timestamp) | Two `saved-*` files → stale bundle, redeploy |
| 10 | Reopen and click **Digitally Sign** | Signature applied; **green/valid** validation banner | Red "Signing failed: …" → read it: rate limit, missing `nutrient.dws.api.token`, or DWS token invalid |
| 11 | — | Banner says trusted/valid, **not** "untrusted" | "Untrusted" → the 3 CA certs aren't uploaded as 3 separate Active records, or `GET /certificates` is 401/403 (shared §6) |
| 12 | Click **Save** on the now-signed doc | Red *"Save is disabled for a signed document…"*; document unchanged | Save succeeds → stale bundle; a saved-after-signing file would have a broken signature (§8) |
| 13 | Open a record with **no** PDF | *"No PDF attachment found on this record."* | — |
| 14 | Repeat 1–13 as `itil` + `nutrient_user` | Identical results | Any 403 → a missing `nutrient_user` grant; **first verify the role actually saved** on the user (Inherited = false) — a silently-failed role add makes every gate deny at once |

**Reporting a problem:** include the browser console, the failing request's
status from the Network tab, and whether you were admin or non-admin. A 500 with
an **empty body and no `sys_log` entry** is almost always ECMAScript 2021 mode
being off on a server script (shared §2).
