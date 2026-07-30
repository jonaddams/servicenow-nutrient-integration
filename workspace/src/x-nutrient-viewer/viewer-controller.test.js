import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SDK_CDN_URL, ensureSdkLoaded, buildToolbar, hasSignature,
  saveToRecord, signDocument, loadTrustedCerts, loadDocument, resolveAttachmentId,
  listPdfAttachments, formatAttachmentMeta, parseUploadedAttachment
} from './viewer-controller.js';

const fakeNutrient = {
  defaultToolbarItems: [{ type: 'zoom-in' }, { type: 'zoom-out' }],
  SignatureType: { CAdES: 'cades' },
  PAdESLevel: { b_lt: 'b-lt' }
};

test('SDK_CDN_URL pins version 1.17.0', () => {
  assert.match(SDK_CDN_URL, /pspdfkit-web@1\.17\.0\/nutrient-viewer\.js$/);
});

test('buildToolbar appends custom Save and Sign items', () => {
  const items = buildToolbar(fakeNutrient, { onSave: () => {}, onSign: () => {} });
  const ids = items.filter((i) => i.type === 'custom').map((i) => i.id);
  assert.deepEqual(ids, ['nutrient-save', 'nutrient-sign']);
  assert.equal(items.length, fakeNutrient.defaultToolbarItems.length + 2);
});

test('hasSignature true when signatures present', async () => {
  const instance = { getSignaturesInfo: async () => ({ signatures: [{}] }) };
  assert.equal(await hasSignature(instance), true);
});

test('hasSignature false when none', async () => {
  const instance = { getSignaturesInfo: async () => ({ signatures: [] }) };
  assert.equal(await hasSignature(instance), false);
});

test('saveToRecord exports then uploads the exported bytes', async () => {
  const calls = [];
  const instance = { exportPDF: async () => { calls.push('export'); return 'BYTES'; } };
  const uploadFn = async (buf) => { calls.push(`upload:${buf}`); };
  await saveToRecord(instance, uploadFn);
  assert.deepEqual(calls, ['export', 'upload:BYTES']);
});

// The caller needs the newly created attachment's identity back: to report the saved
// filename, and to re-point at it so a second Save replaces rather than piles up.
test('saveToRecord returns whatever uploadFn resolves to', async () => {
  const instance = { exportPDF: async () => 'BYTES' };
  const result = await saveToRecord(instance, async () => ({ sysId: 'NEW1', fileName: 'saved-1.pdf' }));
  assert.deepEqual(result, { sysId: 'NEW1', fileName: 'saved-1.pdf' });
});

test('parseUploadedAttachment reads sys_id and file_name from a result envelope', () => {
  const json = { result: { sys_id: 'ATT9', file_name: 'saved-123.pdf', size_bytes: '1000' } };
  assert.deepEqual(parseUploadedAttachment(json), { sysId: 'ATT9', fileName: 'saved-123.pdf' });
});

test('parseUploadedAttachment reads a bare body and tolerates missing fields', () => {
  assert.deepEqual(parseUploadedAttachment({ sys_id: 'A', file_name: 'f.pdf' }), { sysId: 'A', fileName: 'f.pdf' });
  assert.deepEqual(parseUploadedAttachment({}), { sysId: '', fileName: '' });
  assert.deepEqual(parseUploadedAttachment(null), { sysId: '', fileName: '' });
});

test('signDocument mints token then signs with CAdES/b_lt and jwt', async () => {
  let signArgs = null;
  const instance = { signDocument: async (a, b) => { signArgs = [a, b]; } };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ accessToken: 'tok123', id: 'x' }) });
  await signDocument(instance, fakeNutrient, { signUrl: '/api/x/nutrient_dws_signing/sign', fetchImpl });
  assert.equal(signArgs[0].signingData.signatureType, 'cades');
  assert.equal(signArgs[0].signingData.padesLevel, 'b-lt');
  assert.deepEqual(signArgs[1], { jwt: 'tok123' });
});

test('signDocument throws endpoint error message on non-ok', async () => {
  const instance = { signDocument: async () => { throw new Error('should not be called'); } };
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'Rate limit exceeded' }) });
  await assert.rejects(
    () => signDocument(instance, fakeNutrient, { signUrl: '/x', fetchImpl }),
    /Rate limit exceeded/
  );
});

test('loadTrustedCerts returns certificates array', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ success: true, certificates: ['PEM1', 'PEM2'] }) });
  assert.deepEqual(await loadTrustedCerts('/certs', { fetchImpl }), ['PEM1', 'PEM2']);
});

test('loadTrustedCerts returns [] on failure', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  assert.deepEqual(await loadTrustedCerts('/certs', { fetchImpl }), []);
});

// Regression: ServiceNow Scripted REST wraps setBody payloads in a { result: ... }
// envelope. The local harness returned bare bodies, hiding this on a real instance.
test('signDocument reads accessToken from a ServiceNow result envelope', async () => {
  let signArgs = null;
  const instance = { signDocument: async (a, b) => { signArgs = [a, b]; } };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: { success: true, accessToken: 'wrapped-tok', id: 'x' } }) });
  await signDocument(instance, fakeNutrient, { signUrl: '/sign', fetchImpl, userToken: 'UT' });
  assert.deepEqual(signArgs[1], { jwt: 'wrapped-tok' });
});

test('signDocument sends X-UserToken when provided', async () => {
  let captured = null;
  const instance = { signDocument: async () => {} };
  const fetchImpl = async (_url, opts) => { captured = opts; return { ok: true, json: async () => ({ accessToken: 't' }) }; };
  await signDocument(instance, fakeNutrient, { signUrl: '/sign', fetchImpl, userToken: 'UT-123' });
  assert.equal(captured.headers['X-UserToken'], 'UT-123');
});

test('loadTrustedCerts reads certificates from a ServiceNow result envelope', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ result: { success: true, certificates: ['PEM_A'] } }) });
  assert.deepEqual(await loadTrustedCerts('/certs', { fetchImpl }), ['PEM_A']);
});

test('resolveAttachmentId returns newest PDF sys_id and queries sys_attachment for PDFs', async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ result: [{ sys_id: 'ATT1' }] }) }; };
  const id = await resolveAttachmentId({ table: 'incident', recordId: 'REC1', fetchImpl, userToken: 'UT' });
  assert.equal(id, 'ATT1');
  assert.match(capturedUrl, /sys_attachment/);
  assert.match(capturedUrl, /content_typeLIKEpdf/);
});

test('resolveAttachmentId returns empty string without table/recordId', async () => {
  const id = await resolveAttachmentId({ table: '', recordId: '', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(id, '');
});

test('resolveAttachmentId returns empty string on non-ok', async () => {
  const id = await resolveAttachmentId({ table: 'incident', recordId: 'REC1', fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(id, '');
});

// The record-level launcher carries no attachment identity, so a record with more
// than one PDF must offer a choice rather than silently opening the newest.
test('listPdfAttachments returns every PDF newest-first with display fields', async () => {
  let capturedUrl = null;
  const rows = [
    { sys_id: 'NEW', file_name: 'one-bowl.pdf', size_bytes: '75300', sys_created_on: '2026-07-22 13:57:58' },
    { sys_id: 'OLD', file_name: 'marion.pdf', size_bytes: '48800', sys_created_on: '2026-07-20 07:48:09' }
  ];
  const fetchImpl = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ result: rows }) }; };
  const list = await listPdfAttachments({ table: 'incident', recordId: 'REC1', fetchImpl, userToken: 'UT' });
  assert.deepEqual(list.map((r) => r.sys_id), ['NEW', 'OLD']);
  assert.equal(list[0].file_name, 'one-bowl.pdf');
  assert.match(capturedUrl, /sys_attachment/);
  assert.match(capturedUrl, /content_typeLIKEpdf/);
  assert.match(capturedUrl, /ORDERBYDESCsys_created_on/);
  // needs more than sys_id so the picker can label each choice
  assert.match(capturedUrl, /file_name/);
  assert.match(capturedUrl, /size_bytes/);
  assert.match(capturedUrl, /sys_created_on/);
});

test('listPdfAttachments sends X-UserToken and same-origin credentials', async () => {
  let opts = null;
  const fetchImpl = async (_url, o) => { opts = o; return { ok: true, json: async () => ({ result: [] }) }; };
  await listPdfAttachments({ table: 'incident', recordId: 'REC1', fetchImpl, userToken: 'UT-9' });
  assert.equal(opts.headers['X-UserToken'], 'UT-9');
  assert.equal(opts.credentials, 'same-origin');
});

test('listPdfAttachments requests more than one row', async () => {
  let capturedUrl = null;
  const fetchImpl = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ result: [] }) }; };
  await listPdfAttachments({ table: 'incident', recordId: 'REC1', fetchImpl });
  const limit = Number(/sysparm_limit=(\d+)/.exec(capturedUrl)[1]);
  assert.ok(limit > 1, `expected a limit above 1, got ${limit}`);
});

test('listPdfAttachments returns [] without table/recordId, on non-ok, and on throw', async () => {
  assert.deepEqual(await listPdfAttachments({ table: '', recordId: '', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), []);
  assert.deepEqual(await listPdfAttachments({ table: 'incident', recordId: 'R', fetchImpl: async () => ({ ok: false, json: async () => ({}) }) }), []);
  assert.deepEqual(await listPdfAttachments({ table: 'incident', recordId: 'R', fetchImpl: async () => { throw new Error('offline'); } }), []);
});

test('listPdfAttachments tolerates a bare (harness) array body', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ([{ sys_id: 'A' }]) });
  assert.deepEqual((await listPdfAttachments({ table: 't', recordId: 'r', fetchImpl })).map((r) => r.sys_id), ['A']);
});

test('resolveAttachmentId still returns the newest of several PDFs', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ result: [{ sys_id: 'NEWEST' }, { sys_id: 'OLDER' }] })
  });
  assert.equal(await resolveAttachmentId({ table: 'incident', recordId: 'R', fetchImpl }), 'NEWEST');
});

test('formatAttachmentMeta renders decimal size and date, matching the ServiceNow sidebar', () => {
  assert.equal(formatAttachmentMeta({ size_bytes: '48800', sys_created_on: '2026-07-20 07:48:09' }), '48.8 KB · 2026-07-20');
  assert.equal(formatAttachmentMeta({ size_bytes: '2500000', sys_created_on: '2026-01-02 00:00:00' }), '2.5 MB · 2026-01-02');
  assert.equal(formatAttachmentMeta({ size_bytes: '512', sys_created_on: '' }), '512 B');
  assert.equal(formatAttachmentMeta({}), '');
});

test('ensureSdkLoaded resolves existing global without touching DOM', async () => {
  const sdk = await ensureSdkLoaded('http://x', { getGlobal: () => fakeNutrient, doc: null });
  assert.equal(sdk, fakeNutrient);
});

test('ensureSdkLoaded injects a script when global absent', async () => {
  const appended = [];
  let loaded = false;
  const fakeScript = {
    setAttribute() {},
    addEventListener(evt, cb) { if (evt === 'load') { loaded = true; setImmediate(cb); } }
  };
  const doc = {
    querySelector: () => null,
    createElement: () => fakeScript,
    head: { appendChild: (s) => appended.push(s) }
  };
  let calls = 0;
  const getGlobal = () => (loaded && calls++ >= 0 ? fakeNutrient : null);
  const sdk = await ensureSdkLoaded('http://cdn/x.js', { getGlobal, doc });
  assert.equal(appended.length, 1);
  assert.equal(sdk, fakeNutrient);
});

test('signDocument POSTs to signUrl with expirationTime body and same-origin creds', async () => {
  const captured = {};
  const instance = { signDocument: async () => {} };
  const fetchImpl = async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return { ok: true, json: async () => ({ accessToken: 'tok', id: 'x' }) };
  };
  await signDocument(instance, fakeNutrient, { signUrl: '/api/x/nutrient_dws_signing/sign', expirationTime: 1200, fetchImpl });
  assert.equal(captured.url, '/api/x/nutrient_dws_signing/sign');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.credentials, 'same-origin');
  assert.equal(JSON.parse(captured.opts.body).expirationTime, 1200);
});

test('loadTrustedCerts requests the given certsUrl same-origin', async () => {
  const captured = {};
  const fetchImpl = async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return { ok: true, json: async () => ({ certificates: ['P'] }) };
  };
  await loadTrustedCerts('/api/x/nutrient_dws_signing/certificates', { fetchImpl });
  assert.equal(captured.url, '/api/x/nutrient_dws_signing/certificates');
  assert.equal(captured.opts.credentials, 'same-origin');
});

test('loadDocument forwards useCDN:true and load options to NutrientViewer.load', async () => {
  const captured = {};
  const vsMock = { set: (k, v) => { captured.vsSet = { k, v }; return vsMock; } };
  const NutrientViewer = {
    load: async (cfg) => {
      captured.cfg = cfg;
      return { id: 'inst', setViewState: async (fn) => { captured.vsResult = fn(vsMock); } };
    },
    ShowSignatureValidationStatusMode: { IF_SIGNED: 'if-signed' }
  };
  const cb = () => [];
  const container = {};
  const inst = await loadDocument(NutrientViewer, {
    container, arrayBuffer: 'AB', licenseKey: 'LK', toolbarItems: [{ type: 'x' }], trustedCAsCallback: cb
  });
  assert.equal(captured.cfg.useCDN, true);
  assert.equal(captured.cfg.container, container);
  assert.equal(captured.cfg.document, 'AB');
  assert.equal(captured.cfg.licenseKey, 'LK');
  assert.equal(captured.cfg.trustedCAsCallback, cb);
  // banner enabled via ViewState, not load() config
  assert.deepEqual(captured.vsSet, { k: 'showSignatureValidationStatus', v: 'if-signed' });
  assert.equal(inst.id, 'inst');
});

test('ensureSdkLoaded sets script src and marker attribute', async () => {
  const attrs = {};
  let srcVal = '';
  let loaded = false;
  const fakeScript = {
    set src(v) { srcVal = v; },
    get src() { return srcVal; },
    setAttribute(k, v) { attrs[k] = v; },
    addEventListener(evt, cb) { if (evt === 'load') { loaded = true; setImmediate(cb); } }
  };
  const doc = { querySelector: () => null, createElement: () => fakeScript, head: { appendChild() {} } };
  const getGlobal = () => (loaded ? fakeNutrient : null);
  await ensureSdkLoaded('http://cdn/x.js', { getGlobal, doc });
  assert.equal(srcVal, 'http://cdn/x.js');
  assert.equal(attrs['data-nutrient-sdk'], 'true');
});
