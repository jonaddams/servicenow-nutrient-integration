/**
 * Local harness client logic — mirrors the ServiceNow UI Page viewer where it
 * matters (custom toolbar, exportPDF, DWS signing with the corrected enums),
 * minus the ServiceNow-specific glue (GlideAjax, attachment fetch, postMessage).
 */
(function () {
  var instance = null;

  function toast(msg, type, ms) {
    type = type || 'info';
    ms = ms === undefined ? 3000 : ms;
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    if (ms > 0) setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 250); }, ms);
    return t;
  }

  var ICON_SIGN = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M16.32 10.318c.29-.29.29-.77 0-1.06a.754.754 0 0 0-1.06 0l-4.72 4.72-2.26-2.26a.754.754 0 0 0-1.06 0c-.29.29-.29.77 0 1.06l3.32 3.32z"/></svg>';
  var ICON_SAVE = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
  var ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 24 24"><path d="M18.3 5.71 12 12.01l-6.3-6.3-1.4 1.41 6.29 6.3-6.3 6.29 1.41 1.41 6.3-6.3 6.29 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/></svg>';

  function createDigitalSignButton() {
    return { type: 'custom', id: 'digitally-sign', title: 'Digitally Sign', icon: ICON_SIGN, onPress: handleSign };
  }
  function createSaveButton() {
    return { type: 'custom', id: 'save-document', title: 'Save Document', icon: ICON_SAVE, onPress: handleSave };
  }
  function createCloseButton() {
    return {
      type: 'custom', id: 'close-btn', title: 'Close', icon: ICON_CLOSE,
      onPress: function () { toast('Close pressed. In ServiceNow this closes the full-screen overlay.', 'info', 2500); }
    };
  }

  function setupCustomToolbarButtons(inst) {
    inst.setToolbarItems(function (items) {
      return items.concat([createDigitalSignButton(), createSaveButton(), createCloseButton()]);
    });

    // Mirrors the app's toolbar reordering. NOTE: these hard-coded indices depend
    // on the default toolbar length and can shift between SDK versions — guarded
    // so a short toolbar logs a warning instead of inserting `undefined`.
    inst.setToolbarItems(function (items) {
      items.splice(32, 0, { type: 'form-creator' });
      items.splice(33, 0, { type: 'content-editor' });
      items.splice(34, 0, { type: 'document-editor' });
      return items;
    });
    inst.setToolbarItems(function (items) {
      if (items.length > 43) {
        items.splice(21, 0, items.splice(43, 1)[0]);
      } else {
        console.warn('[harness] Toolbar reorder skipped: ' + items.length +
          ' items (<44). The app\'s hard-coded splice(43) would insert `undefined` here — flag to make version-robust.');
      }
      return items;
    });
  }

  function handleSave() {
    var t = toast('Exporting PDF…', 'info', 0);
    instance.exportPDF()
      .then(function (buf) {
        t.remove();
        var url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        var a = document.createElement('a');
        a.href = url; a.download = 'nutrient-export.pdf'; a.click();
        URL.revokeObjectURL(url);
        toast('Exported PDF (downloaded locally). In ServiceNow this POSTs back to the record and deletes the original.', 'success', 5000);
      })
      .catch(function (e) { t.remove(); toast('Export failed: ' + e.message, 'error', 6000); });
  }

  function handleSign() {
    var t = toast('Generating signing token…', 'info', 0);
    fetch('/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.success || !res.j.accessToken) {
          throw new Error(res.j && res.j.error ? res.j.error : 'token mint failed');
        }
        t.remove();
        t = toast('Signing document…', 'info', 0);
        return instance.signDocument(
          { signingData: { signatureType: NutrientViewer.SignatureType.CAdES, padesLevel: NutrientViewer.PAdESLevel.b_lt } },
          { jwt: res.j.accessToken }
        );
      })
      .then(function () { t.remove(); toast('Document digitally signed successfully!', 'success', 4000); showSignatureInfo(); })
      .catch(function (e) { t.remove(); toast('Signing failed: ' + e.message, 'error', 7000); console.error('[harness] sign error', e); });
  }

  function showSignatureInfo() {
    instance.getSignaturesInfo()
      .then(function (info) {
        if (info && info.signatures && info.signatures.length) {
          var valid = info.signatures.filter(function (s) {
            return s.signatureValidationStatus === NutrientViewer.SignatureValidationStatus.valid;
          });
          toast('Found ' + info.signatures.length + ' signature(s): ' + valid.length + ' valid', valid.length ? 'success' : 'warning', 4000);
        }
      })
      .catch(function (e) { console.warn('[harness] getSignaturesInfo', e); });
  }

  function boot() {
    if (typeof NutrientViewer === 'undefined') {
      document.getElementById('boot').textContent = 'NutrientViewer failed to load from the CDN (check network).';
      return;
    }
    var cfg = { container: '#nutrient', document: '/sample.pdf', useCDN: true, toolbarItems: [].concat(NutrientViewer.defaultToolbarItems) };
    if (window.HARNESS_LICENSE) { cfg.licenseKey = window.HARNESS_LICENSE; }
    else { console.log('[harness] No license key set — running in trial/watermark mode.'); }

    NutrientViewer.load(cfg)
      .then(function (inst) {
        instance = inst;
        document.getElementById('boot').style.display = 'none';
        inst.setViewState(function (vs) {
          return vs.set('showSignatureValidationStatus', NutrientViewer.ShowSignatureValidationStatusMode.IF_SIGNED);
        });
        setupCustomToolbarButtons(inst);
        inst.addEventListener('annotations.change', function () { console.log('[harness] annotations changed'); });
        showSignatureInfo();
        console.log('[harness] STEP 9 SUCCESS — Nutrient loaded; pages =', inst.totalPageCount);
      })
      .catch(function (e) {
        document.getElementById('boot').textContent = 'Load failed: ' + e.message;
        console.error('[harness] load error', e);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
