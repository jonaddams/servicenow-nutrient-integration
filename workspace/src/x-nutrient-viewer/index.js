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
// namespace (glide.appcreator.company.code); resolve it via the page's base URL.
const nsPath = (ns) => `/api/${ns}/nutrient_dws_signing`;

const attachmentBinaryUrl = (attachmentId) =>
  `/sys_attachment.do?sys_id=${encodeURIComponent(attachmentId)}`;

async function mountViewer({ host, state, updateState, properties }) {
  const container = host.shadowRoot.querySelector('.nv-root');
  const ns = properties.namespace || '2169521';
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
      try {
        await signDocument(state.instance, NutrientViewer, { signUrl: `${nsPath(ns)}/sign` });
      } catch (e) {
        updateState({ error: `Signing failed: ${e.message}` });
      }
    };
    const onSave = async () => {
      if (await hasSignature(state.instance)) {
        return; // signed docs are read-only to preserve the signature (see README)
      }
      try {
        await saveToRecord(state.instance, async (buffer) => {
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
        updateState({ error: `Save failed: ${e.message}` });
      }
    };

    const toolbarItems = buildToolbar(NutrientViewer, { onSave, onSign });
    const instance = await loadDocument(NutrientViewer, {
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
  initialState: { instance: null, error: '' },
  view: (state, { dispatch }) => {
    if (state.error) {
      return <div className="nv-error">{state.error}</div>;
    }
    return (
      <div
        className="nv-root"
        hook={{ insert: () => dispatch('NV#MOUNT') }}
      />
    );
  },
  actionHandlers: {
    'NV#MOUNT': (coeffects) => {
      const { host, state, updateState, properties } = coeffects;
      if (!properties.attachmentId) {
        updateState({ error: 'No attachment specified.' });
        return;
      }
      mountViewer({ host, state, updateState, properties });
    },
    'COMPONENT_DISCONNECTED': ({ state }) => {
      if (state.instance && typeof state.instance.destroy === 'function') {
        state.instance.destroy();
      }
    }
  }
});
