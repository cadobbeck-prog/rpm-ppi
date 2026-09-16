/* RPM Services PPI — local-first inspection app */
(function () {
  'use strict';

  const DB_NAME = 'rpm-ppi-db';
  const DB_VER = 1;
  const STORE = 'inspections';
  const ACTIVE_KEY = 'active';
  const MAX_PHOTO_EDGE = 1280;
  const JPEG_QUALITY = 0.72;

  const DATA = window.PPI_ITEMS;
  if (!DATA) {
    document.body.innerHTML = '<p style="padding:2rem;color:#fff">Missing items-data.js</p>';
    return;
  }

  const DEMO = {
    year: '2013',
    make: 'Ford',
    model: 'F-550 Super Duty mechanic crane',
    licStk: '',
    vin: '1FDUF5GT3DEB38178',
    mileageIn: '86067',
    mileageOut: '',
    shopName: 'RPM Services',
    shopAddress: '',
    date: '2026-09-16',
    tech: 'Casey Dobbeck',
    client: 'Battle Born Medivac / Brad Kitts',
    dealerLocation: 'Vos Auto Hickman',
    fee: '650',
  };

  let db = null;
  let state = blankState();
  let saveTimer = null;
  let resizeTechPad = null;
  let resizeCustPad = null;

  function blankState() {
    const results = {};
    [...DATA.sections, DATA.commercialSection].forEach((sec) => {
      sec.items.forEach((it) => {
        results[it.id] = { result: null, comment: '', photos: [] };
      });
    });
    const requiredPhotos = {};
    (DATA.photoChecklist || []).forEach((p) => {
      requiredPhotos[p.id] = [];
    });
    return {
      id: ACTIVE_KEY,
      updatedAt: new Date().toISOString(),
      header: { ...DEMO },
      commercialEnabled: true,
      results,
      requiredPhotos,
      technicianComments: '',
      techSignature: '',
      techSigDate: DEMO.date,
      customerSignature: '',
      customerSigDate: '',
    };
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function toast(msg, isErr) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Image load failed'));
      };
      img.src = url;
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = 'image/jpeg';
    var m = parts[0].match(/data:([^;]+)/);
    if (m) mime = m[1];
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  async function savePhotoToDevice(dataUrl, filename) {
    try {
      var blob = dataUrlToBlob(dataUrl);
      var file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.share) {
        try {
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: 'PPI photo' });
            return 'shared';
          }
        } catch (shareErr) {
          // User cancel or share unsupported mid-flight — don't block attach
          if (shareErr && (shareErr.name === 'AbortError' || shareErr.name === 'NotAllowedError')) {
            return 'cancelled';
          }
        }
      }
      downloadBlob(blob, filename);
      return 'downloaded';
    } catch (err) {
      console.error(err);
      return 'failed';
    }
  }

  function photoFilename(kind, key, index) {
    var safe = String(key || 'photo').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
    var n = (index == null ? 1 : index + 1);
    return 'ppi-' + (kind === 'item' ? 'item-' : '') + safe + '-' + n + '.jpg';
  }

  function collectAllJobPhotos() {
    var out = [];
    (DATA.photoChecklist || []).forEach(function (p) {
      var photos = state.requiredPhotos[p.id] || [];
      photos.forEach(function (src, i) {
        out.push({ src: src, filename: photoFilename('req', p.id, i), label: p.label });
      });
    });
    activeSections().forEach(function (sec) {
      sec.items.forEach(function (it) {
        var r = state.results[it.id];
        if (!r || !r.photos || !r.photos.length) return;
        r.photos.forEach(function (src, i) {
          out.push({ src: src, filename: photoFilename('item', it.id, i), label: it.label });
        });
      });
    });
    return out;
  }

  async function saveAllPhotosToPhone() {
    var list = collectAllJobPhotos();
    if (!list.length) {
      toast('No photos in this job yet', true);
      return;
    }
    var ok = 0;
    var failed = 0;
    // Prefer one multi-file share when possible; else sequential download
    try {
      var files = list.map(function (p) {
        var blob = dataUrlToBlob(p.src);
        return new File([blob], p.filename, { type: blob.type || 'image/jpeg' });
      });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: files })) {
        try {
          await navigator.share({ files: files, title: 'PPI photos' });
          toast('Shared ' + files.length + ' photo' + (files.length === 1 ? '' : 's'));
          return;
        } catch (shareErr) {
          if (shareErr && (shareErr.name === 'AbortError' || shareErr.name === 'NotAllowedError')) {
            toast('Share cancelled');
            return;
          }
        }
      }
    } catch (_) {}

    for (var i = 0; i < list.length; i++) {
      var result = await savePhotoToDevice(list[i].src, list[i].filename);
      if (result === 'downloaded' || result === 'shared') ok += 1;
      else if (result === 'failed') failed += 1;
      // Brief pause so multiple downloads don't get blocked by the browser
      if (i < list.length - 1 && result === 'downloaded') {
        await new Promise(function (r) { setTimeout(r, 250); });
      }
    }
    if (ok) toast('Saved ' + ok + ' photo' + (ok === 1 ? '' : 's') + ' to phone' + (failed ? ' (' + failed + ' failed)' : ''));
    else toast('Could not save photos', true);
  }

  function activeSections() {

    const list = DATA.sections.slice();
    if (state.commercialEnabled) list.push(DATA.commercialSection);
    return list;
  }

  function countProgress() {
    let done = 0;
    let total = 0;
    activeSections().forEach((sec) => {
      sec.items.forEach((it) => {
        total += 1;
        if (state.results[it.id] && state.results[it.id].result) done += 1;
      });
    });
    return { done, total };
  }

  function syncHeaderFromForm() {
    const h = state.header;
    const map = {
      year: 'f-year', make: 'f-make', model: 'f-model', licStk: 'f-lic',
      vin: 'f-vin', mileageIn: 'f-mi-in', mileageOut: 'f-mi-out',
      shopName: 'f-shop', shopAddress: 'f-shop-addr', date: 'f-date',
      tech: 'f-tech', client: 'f-client', dealerLocation: 'f-dealer', fee: 'f-fee',
    };
    Object.keys(map).forEach((k) => {
      const el = document.getElementById(map[k]);
      if (el) h[k] = el.value;
    });
    state.technicianComments = document.getElementById('f-tech-comments').value;
    state.techSigDate = document.getElementById('f-tech-sig-date').value;
    state.customerSigDate = document.getElementById('f-cust-sig-date').value;
    state.commercialEnabled = document.getElementById('f-commercial').checked;
    state.updatedAt = new Date().toISOString();
  }

  function fillHeaderForm() {
    const h = state.header;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.value = v || '';
    };
    set('f-year', h.year); set('f-make', h.make); set('f-model', h.model);
    set('f-lic', h.licStk); set('f-vin', h.vin);
    set('f-mi-in', h.mileageIn); set('f-mi-out', h.mileageOut);
    set('f-shop', h.shopName); set('f-shop-addr', h.shopAddress);
    set('f-date', h.date); set('f-tech', h.tech); set('f-client', h.client);
    set('f-dealer', h.dealerLocation); set('f-fee', h.fee);
    document.getElementById('f-tech-comments').value = state.technicianComments || '';
    document.getElementById('f-tech-sig-date').value = state.techSigDate || h.date || '';
    document.getElementById('f-cust-sig-date').value = state.customerSigDate || '';
    document.getElementById('f-commercial').checked = !!state.commercialEnabled;
  }

  function updateProgressUI() {
    const { done, total } = countProgress();
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('prog-text').textContent = done + ' / ' + total + ' items (' + pct + '%)';
  }

  function shortTitle(t) {
    return t
      .replace('INSTRUMENT CLUSTER / GAUGES', 'CLUSTER')
      .replace('STEERING / SUSPENSION COMPONENTS', 'STEERING')
      .replace('WINDSHIELD / WIPERS', 'WIPERS')
      .replace('BRAKE LINES / HOSES', 'BRAKE LINES')
      .replace('ELECTRICAL TESTS', 'ELECTRICAL')
      .replace('Commercial / Upfit', 'UPFIT')
      .replace('WINDOW OPERATION', 'WINDOWS')
      .replace('LATCH OPERATION', 'LATCHES')
      .replace('CLIMATE CONTROL', 'CLIMATE')
      .replace('RUNNING LIGHTS', 'RUNNING')
      .replace('TURN SIGNALS', 'SIGNALS')
      .replace('BRAKE LIGHTS', 'BRAKES LTS')
      .replace('REVERSE LIGHTS', 'REVERSE')
      .replace('INTERIOR LIGHTS', 'INTERIOR')
      .replace('MISCELLANEOUS', 'MISC')
      .replace('UNDERCARRIAGE', 'UNDER')
      .replace('FLUID LEAKS', 'FLUIDS')
      .replace('SEAT BELTS', 'BELTS');
  }

  function renderNav() {
    const nav = document.getElementById('section-nav');
    const parts = ['<a href="#header">Header</a>', '<a href="#photos">Photos</a>'];
    activeSections().forEach((sec) => {
      parts.push('<a href="#sec-' + escapeHtml(sec.id) + '">' + escapeHtml(shortTitle(sec.title)) + '</a>');
    });
    parts.push('<a href="#comments">Notes</a>', '<a href="#signatures">Sign</a>');
    nav.innerHTML = parts.join('');
  }

  function photoUI(kind, key) {
    const list = kind === 'item'
      ? ((state.results[key] && state.results[key].photos) || [])
      : (state.requiredPhotos[key] || []);
    const thumbs = list.map(function (src, i) {
      return '<div class="photo-thumb"><img src="' + src + '" alt="">' +
        '<button type="button" class="rm" data-photo-rm="' + escapeHtml(key) +
        '" data-photo-i="' + i + '" data-photo-kind="' + kind + '">×</button></div>';
    }).join('');
    return '<div class="photo-row">' +
      '<label class="btn btn-sm file-btn no-print">📷 Camera' +
      '<input type="file" accept="image/*" capture="environment" data-photo-add="' +
      escapeHtml(key) + '" data-photo-kind="' + kind + '"></label>' +
      '<label class="btn btn-sm file-btn no-print">🖼 Gallery' +
      '<input type="file" accept="image/*" data-photo-add="' +
      escapeHtml(key) + '" data-photo-kind="' + kind + '"></label>' +
      '<div class="photo-thumbs">' + thumbs + '</div>' +
      (kind === 'req'
        ? '<p class="photo-device-hint muted no-print">Photos stay in this job unless you Save photos to phone (or share/save after each shot).</p>'
        : '') +
      '</div>';
  }

  function resultButtons(itemId, current) {
    function mk(val, cls, label) {
      return '<button type="button" class="result-btn ' + cls +
        (current === val ? ' active' : '') +
        '" data-item="' + escapeHtml(itemId) + '" data-result="' + val + '">' + label + '</button>';
    }
    return '<div class="result-row">' + mk('pass', 'pass', 'PASS') +
      mk('fail', 'fail', 'FAIL') + mk('na', 'na', 'N/A') + '</div>';
  }

  function renderRequiredPhotos() {
    const root = document.getElementById('photo-checklist');
    root.innerHTML = (DATA.photoChecklist || []).map(function (p) {
      const photos = state.requiredPhotos[p.id] || [];
      const done = photos.length > 0;
      return '<div class="photo-check-item' + (done ? ' done' : '') + '">' +
        '<div class="label-row"><span>' + escapeHtml(p.label) + '</span>' +
        '<span class="req-tag">' + (done ? '✓ Captured' : 'Required') + '</span></div>' +
        photoUI('req', p.id) + '</div>';
    }).join('');
  }

  function renderChecklist() {
    const root = document.getElementById('checklist');
    root.innerHTML = activeSections().map(function (sec) {
      const done = sec.items.filter(function (it) {
        return state.results[it.id] && state.results[it.id].result;
      }).length;
      const items = sec.items.map(function (it) {
        const r = state.results[it.id] || { result: null, comment: '', photos: [] };
        return '<div class="item' + (it.safety ? ' safety' : '') + '" id="item-' + escapeHtml(it.id) + '">' +
          '<div class="item-top"><div class="item-label">' + escapeHtml(it.label) + '</div>' +
          (it.safety ? '<span class="safety-badge">★ SAFETY</span>' : '') + '</div>' +
          resultButtons(it.id, r.result) +
          '<textarea class="item-comment" data-comment="' + escapeHtml(it.id) +
          '" placeholder="Comments">' + escapeHtml(r.comment || '') + '</textarea>' +
          photoUI('item', it.id) + '</div>';
      }).join('');
      return '<section class="insp-section" id="sec-' + escapeHtml(sec.id) + '">' +
        '<div class="sec-title"><span>' + escapeHtml(sec.title) + '</span>' +
        '<span class="sec-count">' + done + '/' + sec.items.length + '</span></div>' +
        items + '</section>';
    }).join('');
  }

  function renderDisclaimers() {
    document.getElementById('disclaimers').innerHTML = (DATA.meta.disclaimers || [])
      .map(function (d) { return '<li>' + escapeHtml(d) + '</li>'; }).join('');
  }

  function bindDynamic() {
    document.getElementById('checklist').onclick = onClickDelegate;
    document.getElementById('photo-checklist').onclick = onClickDelegate;
    document.getElementById('checklist').onchange = onFileChange;
    document.getElementById('photo-checklist').onchange = onFileChange;
    document.getElementById('checklist').oninput = onCommentInput;
  }

  function onClickDelegate(e) {
    const btn = e.target.closest('.result-btn');
    if (btn) {
      const id = btn.getAttribute('data-item');
      const val = btn.getAttribute('data-result');
      if (!state.results[id]) state.results[id] = { result: null, comment: '', photos: [] };
      state.results[id].result = state.results[id].result === val ? null : val;
      const row = btn.parentElement;
      row.querySelectorAll('.result-btn').forEach(function (b) { b.classList.remove('active'); });
      if (state.results[id].result) {
        row.querySelector('[data-result="' + state.results[id].result + '"]').classList.add('active');
      }
      updateProgressUI();
      updateSectionCounts();
      scheduleSave();
      return;
    }
    const rm = e.target.closest('[data-photo-rm]');
    if (rm) {
      const key = rm.getAttribute('data-photo-rm');
      const i = Number(rm.getAttribute('data-photo-i'));
      const kind = rm.getAttribute('data-photo-kind');
      if (kind === 'item') {
        state.results[key].photos.splice(i, 1);
        refreshItemPhotos(key);
      } else {
        state.requiredPhotos[key].splice(i, 1);
        renderRequiredPhotos();
        bindDynamic();
      }
      scheduleSave();
    }
  }

  function updateSectionCounts() {
    activeSections().forEach(function (sec) {
      const el = document.querySelector('#sec-' + CSS.escape(sec.id) + ' .sec-count');
      if (!el) return;
      const done = sec.items.filter(function (it) {
        return state.results[it.id] && state.results[it.id].result;
      }).length;
      el.textContent = done + '/' + sec.items.length;
    });
  }

  function onCommentInput(e) {
    const ta = e.target.closest('[data-comment]');
    if (!ta) return;
    const id = ta.getAttribute('data-comment');
    if (!state.results[id]) state.results[id] = { result: null, comment: '', photos: [] };
    state.results[id].comment = ta.value;
    scheduleSave();
  }

  async function onFileChange(e) {
    const input = e.target;
    if (!input.matches('input[type=file][data-photo-add]')) return;
    const file = input.files && input.files[0];
    if (!file) return;
    const key = input.getAttribute('data-photo-add');
    const kind = input.getAttribute('data-photo-kind');
    try {
      const dataUrl = await compressImage(file);
      if (kind === 'item') {
        if (!state.results[key]) state.results[key] = { result: null, comment: '', photos: [] };
        if (!state.results[key].photos) state.results[key].photos = [];
        state.results[key].photos.push(dataUrl);
        refreshItemPhotos(key);
      } else {
        if (!state.requiredPhotos[key]) state.requiredPhotos[key] = [];
        state.requiredPhotos[key].push(dataUrl);
        renderRequiredPhotos();
        bindDynamic();
      }
      scheduleSave();
      toast('Photo attached');
      var idx = kind === 'item'
        ? (state.results[key].photos.length - 1)
        : (state.requiredPhotos[key].length - 1);
      // Offer share/download to Camera Roll / Files; never block the attach
      savePhotoToDevice(dataUrl, photoFilename(kind, key, idx)).catch(function () {});
    } catch (err) {
      console.error(err);
      toast('Photo failed', true);
    }
    input.value = '';
  }

  function refreshItemPhotos(itemId) {
    const itemEl = document.getElementById('item-' + itemId);
    if (!itemEl) return;
    const row = itemEl.querySelector('.photo-row');
    if (!row) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = photoUI('item', itemId);
    row.replaceWith(wrap.firstElementChild);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveNow(true); }, 600);
  }

  function exportBaseName() {
    return 'rpm-ppi-' + (state.header.year || 'veh') + '-' +
      (state.header.make || 'export').replace(/\s+/g, '_') + '-' +
      (state.header.date || 'nodate');
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showSaveSheet() {
    const sheet = document.getElementById('save-sheet');
    const backdrop = document.getElementById('save-sheet-backdrop');
    if (!sheet || !backdrop) return;
    sheet.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(function () {
      sheet.classList.add('show');
      backdrop.classList.add('show');
    });
  }

  function hideSaveSheet() {
    const sheet = document.getElementById('save-sheet');
    const backdrop = document.getElementById('save-sheet-backdrop');
    if (!sheet || !backdrop) return;
    sheet.classList.remove('show');
    backdrop.classList.remove('show');
    setTimeout(function () {
      sheet.hidden = true;
      backdrop.hidden = true;
    }, 250);
  }

  async function saveNow(quiet) {
    syncHeaderFromForm();
    try {
      await idbPut(JSON.parse(JSON.stringify(state)));
      const el = document.getElementById('save-status');
      if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString();
      if (!quiet) toast('Saved in this browser');
      return true;
    } catch (err) {
      console.error(err);
      toast('Save failed — storage full?', true);
      return false;
    }
  }

  async function saveAndOfferDownload() {
    const ok = await saveNow(false);
    if (ok) showSaveSheet();
  }

  function downloadJSONBackup() {
    syncHeaderFromForm();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    downloadBlob(blob, exportBaseName() + '.json');
    toast('JSON saved to device');
  }

  function downloadHTMLReport() {
    syncHeaderFromForm();
    const blob = new Blob([buildReportHTML()], { type: 'text/html' });
    downloadBlob(blob, exportBaseName() + '.html');
    toast('HTML report downloaded');
  }

  async function loadActive() {
    const rec = await idbGet(ACTIVE_KEY);
    if (!rec) return false;
    const base = blankState();
    state = Object.assign({}, base, rec, {
      header: Object.assign({}, base.header, rec.header || {}),
      results: Object.assign({}, base.results, rec.results || {}),
      requiredPhotos: Object.assign({}, base.requiredPhotos, rec.requiredPhotos || {}),
    });
    // Saved blank fields used to block newer DEMO defaults (e.g. VIN).
    // Fill only empty header keys from DEMO so a normal refresh picks them up.
    Object.keys(DEMO).forEach(function (k) {
      const cur = state.header[k];
      if ((cur == null || String(cur).trim() === '') && DEMO[k]) {
        state.header[k] = DEMO[k];
      }
    });
    Object.keys(state.results).forEach(function (k) {
      const r = state.results[k];
      if (!r.photos) r.photos = [];
      if (r.comment == null) r.comment = '';
    });
    return true;
  }

  function resetDemo() {
    if (!confirm('Reset to demo job and clear all results/photos?')) return;
    state = blankState();
    fillHeaderForm();
    fullRerender();
    saveNow(true);
    toast('Demo job loaded');
  }

  function fullRerender() {
    renderNav();
    renderRequiredPhotos();
    renderChecklist();
    bindDynamic();
    updateProgressUI();
    if (resizeTechPad) resizeTechPad();
    if (resizeCustPad) resizeCustPad();
  }

  function exportJSON() {
    downloadJSONBackup();
  }

  function buildReportHTML() {
    syncHeaderFromForm();
    const h = state.header;
    const prog = countProgress();
    let failCount = 0;
    let safetyFail = 0;
    activeSections().forEach(function (sec) {
      sec.items.forEach(function (it) {
        const r = state.results[it.id];
        if (r && r.result === 'fail') {
          failCount += 1;
          if (it.safety) safetyFail += 1;
        }
      });
    });

    function photoImg(src, extraClass) {
      const cls = 'photo-thumb photo-zoom' + (extraClass ? ' ' + extraClass : '');
      return '<img src="' + src + '" class="' + cls + '" alt="" loading="lazy">';
    }

    const gallerySeen = {};
    const gallerySrcs = [];
    function addGallerySrc(src) {
      if (!src || gallerySeen[src]) return;
      gallerySeen[src] = true;
      gallerySrcs.push(src);
    }

    const reqPhotos = (DATA.photoChecklist || []).map(function (p) {
      const photos = state.requiredPhotos[p.id] || [];
      photos.forEach(addGallerySrc);
      if (!photos.length) return '<p><strong>' + escapeHtml(p.label) + ':</strong> (none)</p>';
      return '<div><strong>' + escapeHtml(p.label) + '</strong><div class="photo-row">' +
        photos.map(function (src) { return photoImg(src); }).join('') + '</div></div>';
    }).join('');

    function markCell(result, want) {
      if (result === want) {
        return want === 'fail' ? 'X' : '✓';
      }
      return '&nbsp;';
    }

    const sectionsHtml = activeSections().map(function (sec) {
      const rows = sec.items.map(function (it) {
        const r = state.results[it.id] || {};
        const res = r.result || null;
        const commentCell = (r.comment && String(r.comment).trim()) ? escapeHtml(r.comment) : '&nbsp;';
        return '<tr><td>' + escapeHtml(it.label) + (it.safety ? ' ★' : '') +
          '</td><td class="res">' + markCell(res, 'pass') +
          '</td><td class="res">' + markCell(res, 'fail') +
          '</td><td class="res">' + markCell(res, 'na') +
          '</td><td>' + commentCell + '</td></tr>';
      }).join('');

      const photoItems = sec.items.filter(function (it) {
        const r = state.results[it.id];
        return r && r.photos && r.photos.length;
      });
      let sectionPhotos = '';
      if (photoItems.length) {
        sectionPhotos = '<div class="section-photos"><strong>Section photos</strong>' +
          photoItems.map(function (it) {
            const r = state.results[it.id];
            r.photos.forEach(addGallerySrc);
            return '<div class="photo-block"><div class="photo-label">' + escapeHtml(it.label) +
              (it.safety ? ' ★' : '') + '</div><div class="photo-row">' +
              r.photos.map(function (src) { return photoImg(src); }).join('') + '</div></div>';
          }).join('') + '</div>';
      }

      return '<h3 style="margin:18px 0 6px;border-bottom:2px solid #b91c1c;padding-bottom:4px">' +
        escapeHtml(sec.title) + '</h3><table class="insp">' +
        '<colgroup><col style="width:40%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:30%"></colgroup>' +
        '<thead><tr><th>Item</th><th class="res">Pass</th><th class="res">Fail</th><th class="res">N/A</th><th>Comments</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>' + sectionPhotos;
    }).join('');

    let galleryHtml = '';
    if (gallerySrcs.length) {
      galleryHtml = '<h2>All photos — tap to enlarge</h2><div class="photo-gallery photo-row">' +
        gallerySrcs.map(function (src) { return photoImg(src, 'photo-gallery-thumb'); }).join('') +
        '</div>';
    } else {
      galleryHtml = '<h2>All photos — tap to enlarge</h2><p class="muted">(no photos yet)</p>';
    }

    const metaTable =
      '<table class="meta-table">' +
      '<colgroup><col style="width:18%"><col style="width:32%"><col style="width:18%"><col style="width:32%"></colgroup>' +
      '<tr><th>Year</th><td>' + escapeHtml(h.year) + '</td><th>LIC/STK#</th><td>' + escapeHtml(h.licStk) + '</td></tr>' +
      '<tr><th>Make</th><td>' + escapeHtml(h.make) + '</td><th>VIN</th><td>' + escapeHtml(h.vin) + '</td></tr>' +
      '<tr><th>Model</th><td>' + escapeHtml(h.model) + '</td><th>Mileage</th><td>IN: ' + escapeHtml(h.mileageIn) + ' · OUT: ' + escapeHtml(h.mileageOut) + '</td></tr>' +
      '<tr><th>Date</th><td>' + escapeHtml(h.date) + '</td><th>Tech</th><td>' + escapeHtml(h.tech) + '</td></tr>' +
      '<tr><th>Client</th><td>' + escapeHtml(h.client) + '</td><th>Location</th><td>' + escapeHtml(h.dealerLocation) + '</td></tr>' +
      '<tr><th>Fee</th><td>$' + escapeHtml(h.fee) + '</td><th>Progress</th><td>' + prog.done + '/' + prog.total + ' · Fails: ' + failCount + ' (safety fails: ' + safetyFail + ')</td></tr>' +
      '</table>';

    const sigBlock =
      '<table class="meta-table" style="margin-top:24px">' +
      '<colgroup><col style="width:50%"><col style="width:50%"></colgroup>' +
      '<tr><td><strong>Technician Signature:</strong><br>' +
      (state.techSignature ? '<img src="' + state.techSignature + '" style="max-width:280px;border:1px solid #ccc;background:#fff">' : '(unsigned)') +
      '<br>Date: ' + escapeHtml(state.techSigDate || '') + '</td><td><strong>Customer Signature:</strong><br>' +
      (state.customerSignature ? '<img src="' + state.customerSignature + '" style="max-width:280px;border:1px solid #ccc;background:#fff">' : '(unsigned)') +
      '<br>Date: ' + escapeHtml(state.customerSigDate || '') + '</td></tr></table>';

    const lightbox =
      '<div id="lb" class="lb" hidden>' +
      '<button type="button" class="lb-close" aria-label="Close">×</button>' +
      '<img id="lb-img" alt="">' +
      '</div>';

    const lightboxScript =
      '<script>(function(){' +
      'var lb=document.getElementById("lb");' +
      'var img=document.getElementById("lb-img");' +
      'function openLb(src){img.src=src;lb.hidden=false;document.body.style.overflow="hidden";}' +
      'function closeLb(){lb.hidden=true;img.removeAttribute("src");document.body.style.overflow="";}' +
      'document.addEventListener("click",function(e){' +
      'var t=e.target;' +
      'if(t&&t.classList&&(t.classList.contains("photo-thumb")||t.classList.contains("photo-zoom"))){' +
      'e.preventDefault();openLb(t.getAttribute("src")||t.src);return;}' +
      'if(t===lb||(t&&t.classList&&t.classList.contains("lb-close"))){closeLb();}' +
      '});' +
      'document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!lb.hidden)closeLb();});' +
      '})();<\/script>';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>RPM PPI Report</title>' +
      '<style>' +
      '@page{margin:0.5in}' +
      'body{font-family:system-ui,sans-serif;color:#111;margin:12px;max-width:none}' +
      'h1{margin:0;color:#b91c1c}.muted{color:#555;font-size:13px}' +
      'table.meta-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;margin:12px 0}' +
      'table.meta-table th,table.meta-table td{border:1px solid #bbb;padding:5px 8px;vertical-align:top;word-wrap:break-word;overflow-wrap:anywhere}' +
      'table.meta-table th{background:#f3f3f3;text-align:left;font-weight:700;width:18%}' +
      'table.insp{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px;margin-bottom:8px}' +
      'table.insp th,table.insp td{padding:4px 6px;border:1px solid #999;vertical-align:top;word-wrap:break-word;overflow-wrap:anywhere}' +
      'table.insp th{background:#eee;text-align:left;font-weight:700}' +
      'table.insp th.res,table.insp td.res{text-align:center;font-weight:700}' +
      '.box{border:1px solid #ccc;padding:10px;margin:10px 0}' +
      '.warn{background:#fff7ed;border:1px solid #f59e0b;padding:10px;font-size:12px}' +
      '.section-photos{margin:4px 0 14px;padding:8px;border:1px dashed #ccc;background:#fafafa;font-size:12px}' +
      '.photo-block{margin:6px 0}' +
      '.photo-label{font-weight:600;margin-bottom:4px}' +
      '.photo-row{display:flex;flex-wrap:wrap;gap:8px}' +
      '.photo-thumb{max-width:120px;height:auto;object-fit:cover;border:1px solid #ccc;cursor:zoom-in}' +
      '.photo-gallery{margin:8px 0 16px}' +
      '.photo-gallery-thumb{max-width:200px}' +
      '.lb{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}' +
      '.lb[hidden]{display:none!important}' +
      '.lb img{max-width:95vw;max-height:90vh;width:auto;height:auto;object-fit:contain;border:0;box-shadow:0 4px 24px rgba(0,0,0,.5)}' +
      '.lb-close{position:fixed;top:12px;right:16px;z-index:10000;background:transparent;border:0;color:#fff;font-size:36px;line-height:1;cursor:pointer;padding:4px 10px}' +
      '@media print{button{display:none}.lb,.lb-close{display:none!important}body{margin:0}}' +
      '</style></head><body>' +
      '<button onclick="window.print()" style="padding:10px 16px;font-size:14px;margin-bottom:12px">Print / Save PDF</button>' +
      '<h1>RPM Services — Vehicle Inspection</h1>' +
      '<p class="muted">' + escapeHtml(DATA.meta.formTitle) + ' · ' + escapeHtml(h.shopName || 'RPM Services') +
      (h.shopAddress ? ' · ' + escapeHtml(h.shopAddress) : '') + '</p>' +
      metaTable +
      '<div class="warn"><ul style="margin:0;padding-left:18px">' +
      (DATA.meta.disclaimers || []).map(function (d) { return '<li>' + escapeHtml(d) + '</li>'; }).join('') +
      '</ul></div><h2>Required Photos</h2>' + reqPhotos + galleryHtml + sectionsHtml +
      '<h3>Technician Comments</h3><div class="box">' +
      escapeHtml(state.technicianComments || '(none)').replace(/\n/g, '<br>') + '</div>' +
      sigBlock +
      '<p class="muted">Generated ' + new Date().toLocaleString() + ' · RPM Services PPI</p>' +
      lightbox + lightboxScript +
      '</body></html>';
  }

  function exportReport() {
    const html = buildReportHTML();
    const w = window.open('', '_blank');
    if (!w) {
      toast('Popup blocked — allow popups for report', true);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    toast('Report opened — use Print / Save PDF');
  }

  function setupPad(canvasId, clearId, stateKey) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let last = null;

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(120 * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, rect.width, 120);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (state[stateKey]) {
        const img = new Image();
        img.onload = function () { ctx.drawImage(img, 0, 0, rect.width, 120); };
        img.src = state[stateKey];
      }
    }

    function pos(e) {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    function start(e) { e.preventDefault(); drawing = true; last = pos(e); }
    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }
    function end() {
      if (!drawing) return;
      drawing = false;
      state[stateKey] = canvas.toDataURL('image/png');
      scheduleSave();
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    document.getElementById(clearId).onclick = function () {
      state[stateKey] = '';
      resize();
      scheduleSave();
    };
    resize();
    return resize;
  }

  function wireHeader() {
    document.getElementById('header-form').addEventListener('input', scheduleSave);
    document.getElementById('f-commercial').addEventListener('change', function () {
      syncHeaderFromForm();
      fullRerender();
      scheduleSave();
    });
    document.getElementById('btn-save').onclick = function () { saveAndOfferDownload(); };
    document.getElementById('btn-export-json').onclick = exportJSON;
    document.getElementById('btn-report').onclick = exportReport;
    document.getElementById('btn-demo').onclick = resetDemo;
    document.getElementById('btn-fab-save').onclick = function () { saveAndOfferDownload(); };
    document.getElementById('btn-fab-json').onclick = exportJSON;
    document.getElementById('btn-fab-report').onclick = exportReport;
    var btnPhotos = document.getElementById('btn-save-photos');
    if (btnPhotos) btnPhotos.onclick = function () { saveAllPhotosToPhone(); };
    var btnFabPhotos = document.getElementById('btn-fab-photos');
    if (btnFabPhotos) btnFabPhotos.onclick = function () { saveAllPhotosToPhone(); };

    document.getElementById('btn-save-device').onclick = function () { downloadJSONBackup(); };
    document.getElementById('btn-save-html').onclick = function () { downloadHTMLReport(); };
    document.getElementById('btn-save-done').onclick = hideSaveSheet;
    document.getElementById('save-sheet-backdrop').onclick = hideSaveSheet;
  }

  async function init() {
    renderDisclaimers();
    await openDB();
    const had = await loadActive();
    if (!had) state = blankState();
    fillHeaderForm();
    fullRerender();
    wireHeader();
    resizeTechPad = setupPad('sig-tech', 'clr-tech', 'techSignature');
    resizeCustPad = setupPad('sig-cust', 'clr-cust', 'customerSignature');
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch (_) {}
    }
    toast(had ? 'Resumed saved inspection' : 'Demo job ready');
  }

  init();
})();
