# Shared server layer (UI-agnostic)

These artifacts are independent of which ServiceNow front end launches the viewer, and are reused by every client implementation (`classic-ui/`, and a future `workspace/`). Deploy them **once per instance**, before the client folder.

| File | ServiceNow record | Purpose |
|---|---|---|
| `Script Include - NutrientAttachmentHelper.js` | Script Include (client‑callable) | Returns attachment metadata and loads the trusted CA chain server‑side (so end users need no `sys_certificate` access). Enforces per‑record read access. |
| `Script Rest API - Nutrient DWS API - sign.js` | Scripted REST resource `POST /sign` | Mints short‑lived, origin‑scoped Nutrient DWS signing tokens from the `nutrient.dws.api.token` property. |
| `certificates/*.pem` | `sys_certificate` records (Active) | The DWS signing CA chain (GlobalSign AATL) — upload each as its own record for signatures to validate as trusted. |

Both server scripts require **ECMAScript 2021 mode** enabled on their records. See [`../docs/deployment-guide.html`](../docs/deployment-guide.html) for full steps.
