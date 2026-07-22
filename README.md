# ServiceNow × Nutrient Web SDK

Embed the [Nutrient Web SDK](https://www.nutrient.io/sdk/web/) inside ServiceNow so users can open, annotate, convert, and **digitally sign** record attachments — without the file ever leaving the platform. Signing is brokered server‑side through the Nutrient DWS API, so no API keys reach the browser.

## Status by ServiceNow UI

ServiceNow has two front ends, and the integration point differs between them. This repo is organized around that split.

| Version | Folder | Status |
|---|---|---|
| **Classic / Platform UI** (traditional forms, "UI16") | [`classic-ui/`](./classic-ui) | ✅ **Implemented & validated** (view · save‑as‑PDF · digitally sign, for admin and non‑admin roles) |
| **Workspace** (Agent / Service Operations Workspace, Next Experience / UXF) | [`workspace/`](./workspace) | ✅ **Implemented & validated** on a dev PDI — a UXF component (`x-2169521-nutrient-viewer`) launched from a record action‑bar button ("Open in Nutrient") into a modal; view · save · digitally sign (green‑valid), resolving the record's PDF dynamically. See the folder's README. |

Both versions share the same server layer.

## Layout

```
shared/          Server + certs, UI-agnostic — every version uses these
  Script Include - NutrientAttachmentHelper.js   attachment metadata + trusted-cert loader (GlideAjax)
  Script Rest API - Nutrient DWS API - sign.js   mints short-lived DWS signing tokens
  certificates/                                  DWS signing CA chain (GlobalSign AATL)
classic-ui/      Client layer for the classic Platform UI (the working build)
  Client Script - Nutrient_hook.js               intercepts attachment clicks
  UI Page - nutrient_pdf_viewer.{html,js}        hosts the Nutrient Web SDK
workspace/       Client layer for Agent/Service Operations Workspace (UXF component, built)
docs/            Deployment runbook + original integration guide
local-harness/   Node harness to exercise the Nutrient side offline
```

**Why `shared/` is separate:** a Workspace build would reuse the *same* Script Include, signing endpoint, and certificates unchanged — only the client (how the viewer is launched and hosted) differs per UI. Keeping the server layer in one place avoids duplication and drift.

## Deploy

Follow **[`docs/deployment-guide.html`](./docs/deployment-guide.html)** (open in a browser) — it covers prerequisites, the artifact‑to‑field map, ACLs, certificates, testing, and gotchas. The original inherited walkthrough is [`docs/ServiceNow-Nutrient-Web-SDK-Integration-Guide.md`](./docs/ServiceNow-Nutrient-Web-SDK-Integration-Guide.md).

Deploy order per instance: `shared/` first (server + certs), then the client folder for your UI (`classic-ui/`).

## Credentials

Never committed. Supply per instance:

- **Web SDK license key** → the `licenseKey` in `classic-ui/UI Page - nutrient_pdf_viewer.js` (client‑side, domain‑locked).
- **DWS API token** → ServiceNow system property `nutrient.dws.api.token` (server‑side secret).

A local `.env.local` (git‑ignored) is only a scratch holder for these while working; nothing reads it at runtime.

## Known limitations

- **Two separate clients.** The classic client (client script + DOM interception) runs only in the classic Platform UI; the [`workspace/`](./workspace) client (a UXF component) runs only in Agent/Service Operations Workspace. Both share the `shared/` server layer. Deploy the client(s) for whichever UI(s) the users actually work in.
- **Sign, then Save, invalidates the signature** — Save re‑exports the PDF and rewrites the bytes. Treat signing and convert‑on‑save as mutually exclusive per document.
