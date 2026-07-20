import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SDK_CDN_URL, ensureSdkLoaded, buildToolbar, hasSignature,
  saveToRecord, signDocument, loadTrustedCerts
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
