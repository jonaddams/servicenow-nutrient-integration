# Local harness (optional)

A tiny Node app that runs the Nutrient viewer **outside ServiceNow**, so you can confirm the Nutrient side works — rendering, save, and digital signing — without deploying to an instance.

← Back to the [project overview](../README.md).

**Use it to:**
- Sanity‑check your **Web SDK license key** and **DWS API token** before an instance deploy.
- Give a fast local demo of view / annotate / sign.
- Isolate whether an issue is on the Nutrient side or the ServiceNow side.

It is **not** part of a ServiceNow deployment — it uses none of the `shared/`, `classic-ui/`, or `workspace/` artifacts.

## Run it

1. Put your credentials in a git‑ignored `.env.local` at the **repo root** (one directory up):
   ```
   NUTRIENT_WEB_SDK_LICENSE_KEY=your-web-sdk-key
   NUTRIENT_DWS_API_TOKEN=pdf_live_your-dws-token
   ```
   > For local use, the Web SDK key must be valid for `localhost` (or leave it blank to run in trial/watermarked mode). The DWS token is what enables signing.
2. From this folder:
   ```bash
   node server.mjs
   ```
3. Open **http://localhost:8787**.

The harness mints a short‑lived DWS signing token server‑side (scoped to `digital_signatures_api` and this origin) exactly like the ServiceNow `/sign` endpoint does, so a successful sign here means your token and certificate setup are good.

## Files

| File | Purpose |
|---|---|
| `server.mjs` | Minimal Node server (port `8787`); mints DWS tokens from `.env.local`. |
| `index.html` / `viewer.js` | The page that loads the Nutrient Web SDK and wires up save + sign. |
| `sample.pdf` | A sample document to open. |
| `generate-pdf.mjs` | Regenerates `sample.pdf` (optional). |
