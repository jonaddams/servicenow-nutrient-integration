# Classic / Platform UI client (implemented)

The working client layer for ServiceNow's classic Platform UI (traditional forms, "UI16"). Validated end‑to‑end — view, save‑as‑PDF, and digital signing — for both admin and non‑admin (`itil` + `nutrient_user`) users.

| File | ServiceNow record | Purpose |
|---|---|---|
| `Client Script - Nutrient_hook.js` | Client Script (`onLoad`, Isolate script **off**) | Capture‑phase click interceptor on `/sys_attachment.do` links; opens the viewer full‑screen. |
| `UI Page - nutrient_pdf_viewer.html` | UI Page — **HTML** field | Jelly page that hosts the SDK container + loads `nutrient-viewer.js` from the CDN. |
| `UI Page - nutrient_pdf_viewer.js` | UI Page — **Client script** field | Loads the document, custom toolbar, save‑back, and digital signing. |

Depends on the [`../shared`](../shared) server layer (deploy that first).

**Jelly note:** the UI Page is a Jelly template — do **not** use `${...}` JS template literals in the HTML or Client script fields (Jelly evaluates them server‑side and blanks them). Use string concatenation; `const`/`let`/arrow functions are fine.

Full steps: [`../docs/deployment-guide.html`](../docs/deployment-guide.html).
