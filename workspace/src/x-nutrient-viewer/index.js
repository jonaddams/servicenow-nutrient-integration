import { createCustomElement } from '@servicenow/ui-core';
import snabbdom from '@servicenow/ui-renderer-snabbdom';
import styles from './styles.scss';
import {
  ensureSdkLoaded, buildToolbar, loadDocument, hasSignature,
  saveToRecord, signDocument, loadTrustedCerts, getUserToken,
  listPdfAttachments, formatAttachmentMeta, parseUploadedAttachment
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
// static page props so a single page serves any record. An optional &attachmentId=
// pins one specific attachment, bypassing resolution and the picker.
function urlContext() {
  try {
    const p = new URLSearchParams((typeof window !== 'undefined' && window.location ? window.location.search : '') || '');
    return {
      table: p.get('table') || '',
      recordId: p.get('recordId') || '',
      attachmentId: p.get('attachmentId') || ''
    };
  } catch (e) {
    return { table: '', recordId: '', attachmentId: '' };
  }
}

async function mountViewer({ host, updateState, properties, chosenId = '' }) {
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

    // Which document? In precedence order: the one just picked, an attachmentId
    // pinned on the URL, a static attachmentId prop (ignored once a URL record
    // context is present, so one page can serve any record), else resolve from the
    // record. A record with several PDFs gets a picker rather than a guess — the
    // action-bar launcher cannot tell us which one the user highlighted.
    let attachmentId = chosenId || ctx.attachmentId ||
      ((ctx.table && ctx.recordId) ? '' : properties.attachmentId);
    if (!attachmentId && table && recordId) {
      const pdfs = await listPdfAttachments({ table, recordId });
      if (pdfs.length > 1) {
        updateState({ choices: pdfs });
        return;
      }
      attachmentId = pdfs.length ? pdfs[0].sys_id : '';
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
      updateState({ banner: null });
      try {
        await signDocument(instance, NutrientViewer, { signUrl: `${nsPath(ns)}/sign` });
      } catch (e) {
        updateState({ banner: { kind: 'error', message: `Signing failed: ${e.message}` } });
      }
    };
    // Guards against a second Save landing while the first is still in flight —
    // export + upload is slow enough on a large PDF to double-click through.
    let saving = false;
    const onSave = async () => {
      updateState({ banner: null });
      if (!instance || saving) {
        return;
      }
      if (await hasSignature(instance)) {
        // Signed documents are read-only here: re-exporting would break the
        // signature's byte range. Surface why rather than silently no-op.
        updateState({ banner: { kind: 'error', message: 'Save is disabled for a signed document to preserve its signature.' } });
        return;
      }
      saving = true;
      // Export + upload has no progress of its own; say something so the click
      // does not look ignored.
      updateState({ banner: { kind: 'info', message: 'Saving to the record…' } });
      try {
        // ServiceNow requires the CSRF user token (X-UserToken) on state-changing
        // REST calls authenticated via the session cookie; without it these 401.
        const userToken = getUserToken();
        const saved = await saveToRecord(instance, async (buffer) => {
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
            throw new Error(`upload failed (HTTP ${upload.status})`);
          }
          const created = parseUploadedAttachment(await upload.json());
          // delete original only after a confirmed successful upload
          await fetch(`/api/now/attachment/${encodeURIComponent(attachmentId)}`, {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: userToken ? { 'X-UserToken': userToken } : {}
          });
          return created;
        });
        // The original is gone; re-point at the file we just created so a later
        // Save replaces it instead of adding another copy.
        if (saved.sysId) {
          attachmentId = saved.sysId;
        }
        updateState({
          banner: {
            kind: 'success',
            message: saved.fileName
              ? `Saved to the record as ${saved.fileName}.`
              : 'Saved to the record.'
          }
        });
      } catch (e) {
        updateState({ banner: { kind: 'error', message: `Save failed: ${e.message}` } });
      } finally {
        saving = false;
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
  initialState: { instance: null, error: '', banner: null, choices: [], chosenId: '' },
  view: (state, { dispatch }) => {
    // A pre-mount fatal error (bad attachment / SDK blocked) shows instead of the
    // viewer — nothing has mounted yet. A post-mount action error (sign/save)
    // shows as a banner ABOVE the still-live viewer, so the document stays usable.
    if (state.error) {
      return <div className="nv-error">{state.error}</div>;
    }
    // More than one PDF on the record and nothing pinned: ask which one. Rendering
    // the picker INSTEAD of .nv-root keeps the viewer unmounted; choosing re-renders
    // .nv-root, whose insert hook re-dispatches NV#MOUNT with the chosen id.
    if (state.choices.length) {
      return (
        <div className="nv-picker">
          <h1 className="nv-picker-title">
            This record has {state.choices.length} PDF attachments
          </h1>
          <p className="nv-picker-sub">Choose the one to open.</p>
          <ul className="nv-picker-list">
            {state.choices.map((row) => (
              <li key={row.sys_id}>
                <button
                  type="button"
                  className="nv-picker-item"
                  on={{ click: () => dispatch('NV#PICK', { attachmentId: row.sys_id }) }}
                >
                  <span className="nv-picker-name">{row.file_name || row.sys_id}</span>
                  <span className="nv-picker-meta">{formatAttachmentMeta(row)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className="nv-wrap">
        <div
          className={`nv-banner nv-banner--${state.banner ? state.banner.kind : 'none'}`}
          role={state.banner && state.banner.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          style={{ display: state.banner ? 'block' : 'none' }}
        >
          {state.banner ? state.banner.message : ''}
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
      const { host, updateState, properties, state } = coeffects;
      // Accept a specific attachment, or a record (table + recordId) whose PDFs the
      // viewer will list — from static props OR the URL query params.
      const ctx = urlContext();
      const hasRecord = (properties.table && properties.recordId) || (ctx.table && ctx.recordId);
      const hasAttachment = properties.attachmentId || ctx.attachmentId || state.chosenId;
      if (!hasAttachment && !hasRecord) {
        updateState({ error: 'No attachment or record specified.' });
        return;
      }
      mountViewer({ host, updateState, properties, chosenId: state.chosenId });
    },
    'NV#PICK': ({ action, updateState }) => {
      // Clearing choices swaps the picker back out for .nv-root; its insert hook then
      // fires NV#MOUNT, which reads chosenId and skips resolution.
      updateState({ choices: [], chosenId: action.payload.attachmentId });
    },
    'COMPONENT_DISCONNECTED': ({ state }) => {
      if (state.instance && typeof state.instance.destroy === 'function') {
        state.instance.destroy();
      }
    }
  }
});
