/**
 * Framework-agnostic Nutrient viewer logic. No ServiceNow or snabbdom deps —
 * every external dependency (SDK global, fetch, document) is injectable so this
 * module is unit-testable under `node --test` and reusable in the local harness.
 */

export const SDK_CDN_URL = 'https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.17.0/nutrient-viewer.js';

/**
 * Ensure the Nutrient Web SDK UMD is loaded; resolves with the NutrientViewer global.
 */
export function ensureSdkLoaded(cdnUrl = SDK_CDN_URL, { doc = (typeof document !== 'undefined' ? document : null), getGlobal = () => (typeof window !== 'undefined' ? window.NutrientViewer : undefined) } = {}) {
  return new Promise((resolve, reject) => {
    const existingGlobal = getGlobal();
    if (existingGlobal) {
      resolve(existingGlobal);
      return;
    }
    if (!doc) {
      reject(new Error('No document available to load the Nutrient SDK'));
      return;
    }
    const onLoad = () => resolve(getGlobal());
    const onError = () => reject(new Error('Failed to load the Nutrient SDK script (check CSP trusted domains)'));

    const existingScript = doc.querySelector('script[data-nutrient-sdk]');
    if (existingScript) {
      existingScript.addEventListener('load', onLoad);
      existingScript.addEventListener('error', onError);
      return;
    }
    const script = doc.createElement('script');
    script.src = cdnUrl;
    script.setAttribute('data-nutrient-sdk', 'true');
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    doc.head.appendChild(script);
  });
}

/**
 * Build the toolbar: default items plus custom Save and Digitally Sign buttons.
 */
export function buildToolbar(NutrientViewer, { onSave, onSign }) {
  const items = NutrientViewer.defaultToolbarItems.slice();
  items.push({ type: 'custom', id: 'nutrient-save', title: 'Save', onPress: onSave });
  items.push({ type: 'custom', id: 'nutrient-sign', title: 'Digitally Sign', onPress: onSign });
  return items;
}

/**
 * Load a document into the container from an ArrayBuffer.
 */
export async function loadDocument(NutrientViewer, { container, arrayBuffer, licenseKey, toolbarItems, trustedCAsCallback }) {
  const instance = await NutrientViewer.load({
    container,
    document: arrayBuffer,
    useCDN: true,
    licenseKey,
    toolbarItems,
    trustedCAsCallback
  });
  // Show the green/valid (or warning/error) signature banner once signed, matching
  // the classic build + harness. In the Web SDK this is a ViewState property, NOT a
  // load() option — setting it on load() is silently ignored.
  await instance.setViewState((vs) =>
    vs.set('showSignatureValidationStatus', NutrientViewer.ShowSignatureValidationStatusMode.IF_SIGNED)
  );
  return instance;
}

/**
 * True if the document already contains at least one signature.
 */
export async function hasSignature(instance) {
  const info = await instance.getSignaturesInfo();
  return !!(info && info.signatures && info.signatures.length > 0);
}

/**
 * Export the current document and hand the bytes to uploadFn.
 * uploadFn is responsible for uploading and (only on success) deleting the original.
 */
export async function saveToRecord(instance, uploadFn) {
  const buffer = await instance.exportPDF();
  await uploadFn(buffer);
}

/**
 * ServiceNow CSRF user token for authenticated browser REST calls. Exposed as
 * window.g_ck in both the classic platform UI and Next Experience/UXF pages.
 * Returns undefined outside the browser (e.g. unit tests) so callers can inject.
 */
export function getUserToken() {
  return (typeof window !== 'undefined' && window.g_ck) ? window.g_ck : undefined;
}

/**
 * ServiceNow Scripted REST wraps setBody payloads in a `{ "result": ... }`
 * envelope; the local harness returns them bare. Tolerate both so the same
 * client works against a real instance and the offline harness.
 */
export function unwrapResult(data) {
  return (data && typeof data === 'object' && data.result !== undefined) ? data.result : data;
}

/**
 * When launched from a record-level action (no specific attachment), resolve the
 * record's newest PDF attachment via the Table API. Returns its sys_id, or '' if
 * none / on error. GET needs X-UserToken like the other scoped calls.
 */
export async function resolveAttachmentId({ table, recordId, fetchImpl = fetch, userToken = getUserToken() }) {
  if (!table || !recordId) {
    return '';
  }
  const headers = { Accept: 'application/json' };
  if (userToken) {
    headers['X-UserToken'] = userToken;
  }
  const query = `table_name=${encodeURIComponent(table)}^table_sys_id=${encodeURIComponent(recordId)}` +
    `^content_typeLIKEpdf^ORDERBYDESCsys_created_on`;
  const url = `/api/now/table/sys_attachment?sysparm_limit=1&sysparm_fields=sys_id&sysparm_query=${query}`;
  try {
    const res = await fetchImpl(url, { credentials: 'same-origin', headers });
    if (!res.ok) {
      return '';
    }
    const data = unwrapResult(await res.json());
    const rows = Array.isArray(data) ? data : (data && data.result) || [];
    return rows.length ? rows[0].sys_id : '';
  } catch (error) {
    return '';
  }
}

/**
 * Mint a DWS token from signUrl, then apply a CAdES / PAdES-b_lt signature.
 */
export async function signDocument(instance, NutrientViewer, { signUrl, expirationTime = 3600, fetchImpl = fetch, userToken = getUserToken() }) {
  // ServiceNow requires the CSRF user token (X-UserToken) on state-changing REST
  // calls when authenticating via the session cookie; without it POSTs return 401.
  const headers = { 'Content-Type': 'application/json' };
  if (userToken) {
    headers['X-UserToken'] = userToken;
  }
  const res = await fetchImpl(signUrl, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({ expirationTime })
  });
  if (!res.ok) {
    let message = 'Signing service error';
    try {
      const body = unwrapResult(await res.json());
      if (body && body.error) {
        message = body.error;
      }
    } catch (parseError) {
      // keep default message
    }
    throw new Error(message);
  }
  const data = unwrapResult(await res.json());
  await instance.signDocument(
    {
      signingData: {
        signatureType: NutrientViewer.SignatureType.CAdES,
        padesLevel: NutrientViewer.PAdESLevel.b_lt
      }
    },
    { jwt: data.accessToken }
  );
}

/**
 * Fetch the active trusted CA PEMs for signature validation; [] on failure.
 */
export async function loadTrustedCerts(certsUrl, { fetchImpl = fetch, userToken = getUserToken() } = {}) {
  // Scoped REST endpoints require the CSRF user token (X-UserToken) even for GET
  // when authenticating via the session cookie; without it this returns 401 and
  // trustedCAsCallback gets no CAs → signatures validate as "untrusted".
  const headers = userToken ? { 'X-UserToken': userToken } : {};
  const res = await fetchImpl(certsUrl, { credentials: 'same-origin', headers });
  if (!res.ok) {
    return [];
  }
  const data = unwrapResult(await res.json());
  return (data && data.certificates) || [];
}
