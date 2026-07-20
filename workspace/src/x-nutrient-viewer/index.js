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
// namespace (glide.appcreator.company.code); resolved via the `namespace` property.
const nsPath = (ns) => `/api/${ns}/nutrient_dws_signing`;

const attachmentBinaryUrl = (attachmentId) =>
  `/sys_attachment.do?sys_id=${encodeURIComponent(attachmentId)}`;

async function mountViewer({ host, updateState, properties }) {
  const container = host.shadowRoot.querySelector('.nv-root');
  const ns = properties.namespace || '2169521';
  // The resolved viewer instance lives in this local binding so the toolbar
  // callbacks (invoked later by the SDK) always see the live instance. Reading
  // it back off component state would capture the pre-mount null snapshot.
  let instance = null;
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
        await saveToRecord(instance, async (buffer) => {
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

createCustomElement('x-nutrient-viewer', {
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
      if (!properties.attachmentId) {
        updateState({ error: 'No attachment specified.' });
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
