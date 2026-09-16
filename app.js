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
    vin: '',
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
      '<div class="photo-thumbs">' + thumbs + '</div></div>';
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

  async function saveNow(quiet) {
    syncHeaderFromForm();
    try {
      await idbPut(JSON.parse(JSON.stringify(state)));
      if (!quiet) toast('Saved locally');
      else {
        const el = document.getElementById('save-status');
        if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString();
      }
    } catch (err) {
      console.error(err);
      toast('Save failed — storage full?', true);
    }
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
    saveNow(false);
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
    syncHeaderFromForm();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const name = 'rpm-ppi-' + (state.header.year || 'veh') + '-' +
      (state.header.make || 'export').replace(/\s+/g, '_') + '-' +
      (state.header.date || 'nodate') + '.json';
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('JSON downloaded');
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

    const reqPhotos = (DATA.photoChecklist || []).map(function (p) {
      const photos = state.requiredPhotos[p.id] || [];
      if (!photos.length) return '<p><strong>' + escapeHtml(p.label) + ':</strong> (none)</p>';
      return '<div><strong>' + escapeHtml(p.label) + '</strong><div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0">' +
        photos.map(function (src) {
          return '<img src="' + src + '" style="width:160px;height:120px;object-fit:cover;border:1px solid #ccc">';
        }).join('') + '</div></div>';
    }).join('');

    const sectionsHtml = activeSections().map(function (sec) {
      const rows = sec.items.map(function (it) {
        const r = state.results[it.id] || {};
        const res = (r.result || '—').toUpperCase();
        const photos = (r.photos || []).map(function (src) {
          return '<img src="' + src + '" style="width:100px;height:75px;object-fit:cover;margin:2px;border:1px solid #ccc">';
        }).join('');
        return '<tr><td>' + escapeHtml(it.label) + (it.safety ? ' ★' : '') +
          '</td><td style="text-align:center;font-weight:700">' + escapeHtml(res) +
          '</td><td>' + escapeHtml(r.comment || '') + '</td><td>' + photos + '</td></tr>';
      }).join('');
      return '<h3 style="margin:18px 0 6px;border-bottom:2px solid #b91c1c;padding-bottom:4px">' +
        escapeHtml(sec.title) + '</h3><table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="background:#eee"><th align="left">Item</th><th>Result</th><th align="left">Comments</th><th>Photos</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    }).join('');

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>RPM PPI Report</title>' +
      '<style>body{font-family:system-ui,sans-serif;color:#111;margin:24px;max-width:900px}' +
      'h1{margin:0;color:#b91c1c}.muted{color:#555;font-size:13px}' +
      '.meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin:12px 0;font-size:13px}' +
      '.box{border:1px solid #ccc;padding:10px;margin:10px 0}' +
      '.warn{background:#fff7ed;border:1px solid #f59e0b;padding:10px;font-size:12px}' +
      '@media print{button{display:none}}</style></head><body>' +
      '<button onclick="window.print()" style="padding:10px 16px;font-size:14px;margin-bottom:12px">Print / Save PDF</button>' +
      '<h1>RPM Services — Vehicle Inspection</h1>' +
      '<p class="muted">' + escapeHtml(DATA.meta.formTitle) + ' · ' + escapeHtml(h.shopName || 'RPM Services') +
      (h.shopAddress ? ' · ' + escapeHtml(h.shopAddress) : '') + '</p>' +
      '<div class="meta">' +
      '<div><strong>Year:</strong> ' + escapeHtml(h.year) + '</div>' +
      '<div><strong>LIC/STK#:</strong> ' + escapeHtml(h.licStk) + '</div>' +
      '<div><strong>Make:</strong> ' + escapeHtml(h.make) + '</div>' +
      '<div><strong>VIN:</strong> ' + escapeHtml(h.vin) + '</div>' +
      '<div><strong>Model:</strong> ' + escapeHtml(h.model) + '</div>' +
      '<div><strong>Mileage IN:</strong> ' + escapeHtml(h.mileageIn) + ' · <strong>OUT:</strong> ' + escapeHtml(h.mileageOut) + '</div>' +
      '<div><strong>Date:</strong> ' + escapeHtml(h.date) + '</div>' +
      '<div><strong>Tech:</strong> ' + escapeHtml(h.tech) + '</div>' +
      '<div><strong>Client:</strong> ' + escapeHtml(h.client) + '</div>' +
      '<div><strong>Location:</strong> ' + escapeHtml(h.dealerLocation) + '</div>' +
      '<div><strong>Fee:</strong> $' + escapeHtml(h.fee) + '</div>' +
      '<div><strong>Progress:</strong> ' + prog.done + '/' + prog.total + ' · Fails: ' + failCount + ' (safety fails: ' + safetyFail + ')</div>' +
      '</div><div class="warn"><ul style="margin:0;padding-left:18px">' +
      (DATA.meta.disclaimers || []).map(function (d) { return '<li>' + escapeHtml(d) + '</li>'; }).join('') +
      '</ul></div><h2>Required Photos</h2>' + reqPhotos + sectionsHtml +
      '<h3>Technician Comments</h3><div class="box">' +
      escapeHtml(state.technicianComments || '(none)').replace(/\n/g, '<br>') + '</div>' +
      '<div class="meta" style="margin-top:24px">' +
      '<div><strong>Technician Signature:</strong><br>' +
      (state.techSignature ? '<img src="' + state.techSignature + '" style="max-width:280px;border:1px solid #ccc;background:#fff">' : '(unsigned)') +
      '<br>Date: ' + escapeHtml(state.techSigDate || '') + '</div>' +
      '<div><strong>Customer Signature:</strong><br>' +
      (state.customerSignature ? '<img src="' + state.customerSignature + '" style="max-width:280px;border:1px solid #ccc;background:#fff">' : '(unsigned)') +
      '<br>Date: ' + escapeHtml(state.customerSigDate || '') + '</div></div>' +
      '<p class="muted">Generated ' + new Date().toLocaleString() + ' · RPM Services PPI</p></body></html>';
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
    document.getElementById('btn-save').onclick = function () { saveNow(false); };
    document.getElementById('btn-export-json').onclick = exportJSON;
    document.getElementById('btn-report').onclick = exportReport;
    document.getElementById('btn-demo').onclick = resetDemo;
    document.getElementById('btn-fab-save').onclick = function () { saveNow(false); };
    document.getElementById('btn-fab-json').onclick = exportJSON;
    document.getElementById('btn-fab-report').onclick = exportReport;
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
