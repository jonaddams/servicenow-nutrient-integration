# Workspace implementation — not yet built

Target: **Agent Workspace / Service Operations Workspace** (ServiceNow's Next Experience / UX Framework — Seismic components).

## Why the classic build doesn't work here

The [`classic-ui/`](../classic-ui) implementation launches the viewer with a **client script** (`onLoad`) that intercepts attachment‑link clicks in the DOM. Client scripts and DOM interception run in the **classic Platform UI** only. In a Workspace:

- `onLoad` client scripts don't run the same way, and there's no attachment `<a href="/sys_attachment.do">` in the DOM to intercept.
- Attachment clicks are handled by the Workspace's own attachment component, which opens ServiceNow's native document preview — Nutrient never loads.

So this isn't a config tweak; it needs a Workspace‑native front end.

## Suggested approach (for when this is scoped)

Build the client layer as a **UX Framework component** (or configure/extend the Workspace attachment experience) that mounts the Nutrient Web SDK, and **reuse the shared server layer unchanged**:

| Reused from [`shared/`](../shared) | Purpose |
|---|---|
| `Script Include - NutrientAttachmentHelper.js` | Attachment metadata + trusted‑cert loading (GlideAjax) |
| `Script Rest API - Nutrient DWS API - sign.js` | DWS signing‑token minting |
| `certificates/` | Signature validation trust chain |

Likely building blocks: a custom Now Experience UI component (or a UI Builder page/macroponent) hosting the SDK; wiring to the shared Script Include via a scriptable data resource / GlideAjax equivalent; the same `/api/<ns>/nutrient_dws_signing/sign` endpoint for signing.

## Status / next step

Not started. Scope it **with the prospect** — the effort only matters if their fulfillers actually work in a Workspace rather than the classic UI. Estimated as a multi‑day build (new framework, new component), versus the classic build which is complete.
