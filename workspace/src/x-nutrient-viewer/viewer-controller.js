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
export function loadDocument(NutrientViewer, { container, arrayBuffer, licenseKey, toolbarItems, trustedCAsCallback }) {
  return NutrientViewer.load({
    container,
    document: arrayBuffer,
    useCDN: true,
    licenseKey,
    toolbarItems,
    trustedCAsCallback
  });
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
 * Mint a DWS token from signUrl, then apply a CAdES / PAdES-b_lt signature.
 */
export async function signDocument(instance, NutrientViewer, { signUrl, expirationTime = 3600, fetchImpl = fetch }) {
  const res = await fetchImpl(signUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ expirationTime })
  });
  if (!res.ok) {
    let message = 'Signing service error';
    try {
      const body = await res.json();
      if (body && body.error) {
        message = body.error;
      }
    } catch (parseError) {
      // keep default message
    }
    throw new Error(message);
  }
  const data = await res.json();
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
export async function loadTrustedCerts(certsUrl, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(certsUrl, { credentials: 'same-origin' });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return (data && data.certificates) || [];
}
