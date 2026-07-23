import { createCustomElement } from '@servicenow/ui-core';
import snabbdom from '@servicenow/ui-renderer-snabbdom';
import styles from './styles.scss';
import {
  ensureSdkLoaded, buildToolbar, loadDocument, hasSignature,
  saveToRecord, signDocument, loadTrustedCerts, getUserToken, resolveAttachmentId
} from './viewer-controller.js';

// License key is injected per-instance (domain-locked). Kept here to mirror the
// classic UI Page; a customer can move it to a system property + endpoint.
const LICENSE_KEY = '';

// Endpoints under the scoped service `nutrient_dws_signing`. `<ns>` is the scope
// namespace (glide.appcreator.company.code); resolved via the `namespace` property.
const nsPath = (ns) => `/api/${ns}/nutrient_dws_signing`;

const attachmentBinaryUrl = (attachmentId) =>
  `/sys_attachment.do?sys_id=${encodeURIComponent(attachmentId)}`;

// When hosted on the standalone modal page, the record context arrives as URL query
// params (?table=&recordId=) from the "Open in Nutrient" launcher. Prefer those over
// static page props so a single page serves any record.
function urlContext() {
  try {
    const p = new URLSearchParams((typeof window !== 'undefined' && window.location ? window.location.search : '') || '');
    return { table: p.get('table') || '', recordId: p.get('recordId') || '' };
  } catch (e) {
    return { table: '', recordId: '' };
  }
}

async function mountViewer({ host, updateState, properties }) {
  const container = host.shadowRoot.querySelector('.nv-root');
  const ns = properties.namespace || '2169521';
  // Record context: URL query params (from the modal launcher) win over static props,
  // so one standalone page works for any record.
  const ctx = urlContext();
  const table = ctx.table || properties.table;
  const recordId = ctx.recordId || properties.recordId;
  // The resolved viewer instance lives in this local binding so the toolbar
  // callbacks (invoked later by the SDK) always see the live instance. Reading
  // it back off component state would capture the pre-mount null snapshot.
  let instance = null;
  try {
    const NutrientViewer = await ensureSdkLoaded();

    // Per-attachment (explicit attachmentId) or record-level (resolve the record's
    // newest PDF). A URL record context overrides any static attachmentId prop.
    let attachmentId = (ctx.table && ctx.recordId) ? '' : properties.attachmentId;
    if (!attachmentId && table && recordId) {
      attachmentId = await resolveAttachmentId({ table, recordId });
    }
    if (!attachmentId) {
      updateState({ error: 'No PDF attachment found on this record.' });
      return;
    }

    const res = await fetch(attachmentBinaryUrl(attachmentId), { credentials: 'same-origin' });
    if (!res.ok) {
      updateState({ error: 'Unable to load attachment — you may not have access.' });
      return;
    }
    const arrayBuffer = await res.arrayBuffer();
    const trustedCerts = await loadTrustedCerts(`${nsPath(ns)}/certificates`);

    const onSign = async () => {
      updateState({ bannerError: '' });
      try {
        await signDocument(instance, NutrientViewer, { signUrl: `${nsPath(ns)}/sign` });
      } catch (e) {
        updateState({ bannerError: `Signing failed: ${e.message}` });
      }
    };
    const onSave = async () => {
      updateState({ bannerError: '' });
      if (!instance) {
        return;
      }
      if (await hasSignature(instance)) {
        // Signed documents are read-only here: re-exporting would break the
        // signature's byte range. Surface why rather than silently no-op.
        updateState({ bannerError: 'Save is disabled for a signed document to preserve its signature.' });
        return;
      }
      try {
        // ServiceNow requires the CSRF user token (X-UserToken) on state-changing
        // REST calls authenticated via the session cookie; without it these 401.
        const userToken = getUserToken();
        await saveToRecord(instance, async (buffer) => {
          // Save is only reachable for UNSIGNED documents (signed docs are blocked
          // above to preserve their byte range), so the name must not imply "signed".
          const upload = await fetch(
            `/api/now/attachment/file?table_name=${encodeURIComponent(table)}` +
            `&table_sys_id=${encodeURIComponent(recordId)}` +
            `&file_name=saved-${Date.now()}.pdf`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/pdf', ...(userToken ? { 'X-UserToken': userToken } : {}) },
              body: buffer
            }
          );
          if (!upload.ok) {
            throw new Error('upload failed');
          }
          // delete original only after a confirmed successful upload
          await fetch(`/api/now/attachment/${encodeURIComponent(attachmentId)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: userToken ? { 'X-UserToken': userToken } : {}
          });
        });
      } catch (e) {
        updateState({ bannerError: `Save failed: ${e.message}` });
      }
    };

    const toolbarItems = buildToolbar(NutrientViewer, { onSave, onSign });
    instance = await loadDocument(NutrientViewer, {
      container, arrayBuffer, licenseKey: LICENSE_KEY, toolbarItems,
      trustedCAsCallback: () => trustedCerts
    });
    updateState({ instance });
  } catch (e) {
    updateState({ error: `Viewer failed to load — verify CSP trusted domains. (${e.message})` });
  }
}

createCustomElement('x-2169521-nutrient-viewer', {
  renderer: { type: snabbdom },
  styles,
  properties: {
    attachmentId: { default: '' },
    table: { default: '' },
    recordId: { default: '' },
    namespace: { default: '2169521' }
  },
  initialState: { instance: null, error: '', bannerError: '' },
  view: (state, { dispatch }) => {
    // A pre-mount fatal error (bad attachment / SDK blocked) shows instead of the
    // viewer — nothing has mounted yet. A post-mount action error (sign/save)
    // shows as a banner ABOVE the still-live viewer, so the document stays usable.
    if (state.error) {
      return <div className="nv-error">{state.error}</div>;
    }
    return (
      <div className="nv-wrap">
        <div
          className="nv-banner"
          style={{ display: state.bannerError ? 'block' : 'none' }}
        >
          {state.bannerError || ''}
        </div>
        <div
          className="nv-root"
          hook={{ insert: () => dispatch('NV#MOUNT') }}
        />
      </div>
    );
  },
  actionHandlers: {
    'NV#MOUNT': (coeffects) => {
      const { host, updateState, properties } = coeffects;
      // Accept a specific attachment, or a record (table + recordId) whose newest PDF
      // the viewer will resolve — from static props OR the URL query params.
      const ctx = urlContext();
      const hasRecord = (properties.table && properties.recordId) || (ctx.table && ctx.recordId);
      if (!properties.attachmentId && !hasRecord) {
        updateState({ error: 'No attachment or record specified.' });
        return;
      }
      mountViewer({ host, updateState, properties });
    },
    'COMPONENT_DISCONNECTED': ({ state }) => {
      if (state.instance && typeof state.instance.destroy === 'function') {
        state.instance.destroy();
      }
    }
  }
});
