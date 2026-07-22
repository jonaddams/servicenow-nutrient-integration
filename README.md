# ServiceNow × Nutrient Web SDK

Open, annotate, convert, and **digitally sign** ServiceNow record attachments right inside the platform — the file never leaves ServiceNow. Powered by the [Nutrient Web SDK](https://www.nutrient.io/sdk/web/), with signing brokered server‑side through the [Nutrient DWS API](https://www.nutrient.io/api/) so no API keys are ever exposed to the browser.

> **New here? Read this page top to bottom, then follow the two links in [Deploy](#deploy).** Each step is written to be copy‑paste explicit — no prior Nutrient experience assumed.

---

## What you get

- **View** any PDF (or Office doc, image) attached to a record, in a full document viewer.
- **Annotate** — highlight, comment, draw, add text and stamps.
- **Save as PDF** — write the edited document back to the record.
- **Digitally sign** — apply a cryptographic signature via Nutrient DWS that validates as **trusted/green** (chained to a publicly‑trusted Adobe Approved Trust List root).
- **Stays in‑platform** — no downloads, no third‑party upload of the document, no API keys in the browser.

---

## Which build do I need?

ServiceNow has **two different user interfaces**, and they need **different clients**. Deploy the one your users actually work in (or both).

| If your users work in… | You need | Folder | What it looks like |
|---|---|---|---|
| **Classic / Platform UI** — the traditional form view (e.g. `incident.do`, "UI16") | **Classic client** | [`classic-ui/`](./classic-ui) | Clicking an attachment opens the viewer full‑screen. |
| **Agent / Service Operations Workspace** — the tabbed "Next Experience" workspace | **Workspace client** | [`workspace/`](./workspace) | An **Open in Nutrient** button on the record opens the viewer in a modal. |

**Not sure which one your users use?** Open a record (e.g. an incident) the way your fulfillers normally do:
- If the URL looks like `.../nav_to.do?uri=incident.do...` and you see a single classic form → **Classic**.
- If the URL looks like `.../now/sow/record/...` or `.../now/workspace/...` with tabs down the side → **Workspace**.

Both clients share the **same server layer** ([`shared/`](./shared)) — you deploy that once, first, regardless of which client(s) you choose.

---

## How the pieces fit

```
┌─────────────────────────────────────────────┐
│  shared/   ← deploy FIRST, once per instance │
│  Server layer used by BOTH clients:          │
│   • Script Include (attachment + cert helper)│
│   • Scripted REST API (mint signing tokens,  │
│     serve metadata + certificates)           │
│   • Trusted CA certificates                   │
└─────────────────────────────────────────────┘
              ▲                    ▲
              │                    │
   ┌──────────┴─────────┐  ┌───────┴──────────────┐
   │  classic-ui/       │  │  workspace/          │
   │  Classic UI client │  │  Workspace (UXF)     │
   │  (UI Page + hook)  │  │  client (component)  │
   └────────────────────┘  └──────────────────────┘
```

**Why the server layer is shared:** both UIs use the *same* signing endpoint, certificates, and helper logic — only *how the viewer is launched* differs. Keeping the server in one place avoids duplication and drift.

---

## Deploy

Deploy in this order. Each guide is step‑by‑step; start with the shared server layer, then do the client for your UI.

### Step 1 — Server layer (required for everyone)
➡️ **[`shared/README.md`](./shared/README.md)** — Script Include, Scripted REST API, trusted certificates, roles, and ACLs.

### Step 2 — Your client
- **Classic UI:** ➡️ **[`classic-ui/README.md`](./classic-ui/README.md)**
- **Workspace:** ➡️ **[`workspace/README.md`](./workspace/README.md)**

*(Deploying both UIs? Do Step 1 once, then both client guides — they don't conflict.)*

> **Optional:** [`local-harness/`](./local-harness) is a small Node app to exercise the Nutrient viewer + signing **offline**, without a ServiceNow instance. Handy for a quick demo or to confirm your license key and DWS token work. Not part of a ServiceNow deployment.

---

## Prerequisites (both builds)

| What | Why | How to get it |
|---|---|---|
| A ServiceNow instance + **admin** access | All artifacts install in the **Global** scope | A free [Personal Developer Instance](https://developer.servicenow.com/) is fine for evaluation. |
| **Nutrient Web SDK license key** | Renders the viewer without a watermark | From your Nutrient contact. ⚠️ **Domain‑locked** — it must cover your instance host (e.g. `devXXXXX.service-now.com`), or the viewer watermarks and signatures show as modified. |
| **Nutrient DWS API token** | Lets the server mint short‑lived signing tokens | [`dashboard.nutrient.io`](https://dashboard.nutrient.io) → API keys (a `pdf_live_…` key). Stored server‑side only. |
| **Trusted CA certificates** | Makes signatures validate as trusted/green | Included in this repo — see [`shared/certificates/`](./shared/certificates). |

---

## Credentials — never committed

Supply these per instance; they are **not** stored in this repo:

- **Web SDK license key** → set in the client (Classic: the UI Page; Workspace: the component). Client‑side and domain‑locked.
- **DWS API token** → the ServiceNow system property `nutrient.dws.api.token`. Server‑side secret; never reaches the browser.

A local, git‑ignored `.env.local` may hold these while you work, but nothing reads it at runtime.

---

## Known limitations

- **One client per UI.** The Classic client runs only in the classic Platform UI; the Workspace client runs only in Agent/Service Operations Workspace. They don't overlap — deploy the client(s) matching where your users work.
- **Sign, *then* Save, invalidates the signature.** Saving re‑exports the PDF and rewrites its bytes, which breaks an existing signature. Treat "digitally sign" and "save/convert" as mutually exclusive per document. (Both clients disable or warn against this.)

---

## Repository layout

```
README.md          You are here — start point + prerequisites + deploy order
shared/            Server layer (deploy first) — Script Include, REST API, certificates
classic-ui/        Classic Platform UI client — UI Page + attachment‑click hook
workspace/         Workspace (UXF) client — custom component + record action
local-harness/     Optional offline Node harness to demo the Nutrient side
```

Each folder has its own step‑by‑step README.
