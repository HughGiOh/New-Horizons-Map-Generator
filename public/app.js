// app.js — editor: recolour territories + edit place-name text (canvas, 1:1). Exports a transparent overlay PNG.
const LS_KEY = 'nh-map-colors-v1';
const LB_KEY = 'nh-map-labels-v1';
const $ = s => document.querySelector(s);
const canvas = $('#map');
const ctx = canvas.getContext('2d');
const labelCanvas = $('#labelCanvas');
const lctx = labelCanvas.getContext('2d');
const measureCtx = document.createElement('canvas').getContext('2d');

let manifest, baseImg, linesImg;
const masks = {};            // file -> HTMLImageElement
const tintCache = {};        // `${file}|${hex}` -> canvas
let state = {};              // num -> { hex } (territory colour overrides)
let labels = [];             // [{id,text,x,y,size,rot,track,color,stroke,strokeColor,curve,hidden}]
let selectedId = null;

// shared-backend state
let serverMode = false, editMode = true, authLevel = null;
let editPassword = '', editorName = '', currentVersion = null;
let loadedVersion = 0, viewingOld = null;
const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const canEdit = () => editMode;
const canMove = () => editMode && (!serverMode || authLevel === 'admin');   // moving text = admin only (shared mode)

const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

async function init() {
  manifest = await (await fetch('assets/manifest.json')).json();
  canvas.width = labelCanvas.width = manifest.width;
  canvas.height = labelCanvas.height = manifest.height;

  try {
    const f = new FontFace(manifest.font.family, `url(assets/${manifest.font.file})`, { weight: String(manifest.font.weight) });
    document.fonts.add(await f.load());
  } catch (e) { console.warn('font load failed', e); }

  [baseImg, linesImg] = await Promise.all([load('assets/' + manifest.base), load('assets/' + manifest.overlayLines)]);
  await Promise.all(manifest.territories.flatMap(t => t.parts.map(async p => { masks[p.file] = await load('assets/' + p.file); })));

  serverMode = await loadFromServer();
  if (!serverMode) {
    try { state = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { state = {}; }
    try { labels = JSON.parse(localStorage.getItem(LB_KEY)); } catch { labels = null; }
    if (!Array.isArray(labels)) labels = manifest.labels.map(l => ({ ...l }));
  }
  labels.forEach(labelDefaults);

  buildQuick();
  buildList();
  render();
  renderLabels();
  buildLabelList();
  wireButtons();
  wireTabs();
  wireLabelCanvas();
  wireZoom();
  applyZoom();
  wireServerUI();
  setEditMode(!serverMode);
  new ResizeObserver(() => applyZoom()).observe($('.canvas-wrap'));
}

// ---------- shared backend ----------
async function loadFromServer() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) return false;
    const { latest } = await res.json();
    if (latest) {
      state = latest.state || {};
      labels = Array.isArray(latest.labels) ? latest.labels.map(l => ({ ...l })) : manifest.labels.map(l => ({ ...l }));
      currentVersion = { version: latest.version, ts: latest.ts, editor: latest.editor };
      loadedVersion = latest.version;
    } else {
      state = {}; labels = manifest.labels.map(l => ({ ...l })); currentVersion = null; loadedVersion = 0;
    }
    return true;
  } catch { return false; }
}

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('viewonly', serverMode && !on);
  const b = $('#btnEdit');
  if (b && serverMode) { b.textContent = on ? '💾 Save…' : 'Edit'; b.classList.toggle('primary', on); }
  $('#btnAdmin').classList.toggle('hidden', !(on && authLevel === 'admin'));
  if (selectedId) buildLabelEditor();
  renderLabels();
}

function refreshAll() { labels.forEach(labelDefaults); render(); renderLabels(); buildLabelList(); buildLabelEditor(); manifest.territories.forEach(t => syncRow(t.id)); }

function wireTabs() {
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#pane-terr').classList.toggle('hidden', t.dataset.tab !== 'terr');
    $('#pane-text').classList.toggle('hidden', t.dataset.tab !== 'text');
  });
}

// ---------- territory colouring ----------
function colorOf(t) { if (t.id in state) return state[t.id].hex; return t.hiddenByDefault ? null : t.defaultHex; }
function isChanged(t) { return t.id in state; }

function tintedPart(p, hex) {
  const key = p.file + '|' + hex;
  if (tintCache[key]) return tintCache[key];
  const c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
  const cx = c.getContext('2d');
  cx.drawImage(masks[p.file], 0, 0);
  cx.globalCompositeOperation = 'source-in'; cx.fillStyle = hex; cx.fillRect(0, 0, p.w, p.h);
  tintCache[key] = c; return c;
}
function paintTerritories(cx) {
  for (const t of manifest.territories) {
    const hex = colorOf(t); if (!hex) continue;
    cx.globalAlpha = t.opacity;
    for (const p of t.parts) cx.drawImage(tintedPart(p, hex), p.x, p.y);
  }
  cx.globalAlpha = 1;
}
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
  paintTerritories(ctx);
  ctx.drawImage(linesImg, 0, 0);
}

const persist = () => localStorage.setItem(LS_KEY, JSON.stringify(state));
const persistLabels = () => localStorage.setItem(LB_KEY, JSON.stringify(labels));
function setColor(num, hex) { state[num] = { hex }; persist(); render(); syncRow(num); }
function resetColor(num) { delete state[num]; persist(); render(); syncRow(num); }

// ---------- text labels (rendered on #labelCanvas, 1:1 with export) ----------
const scale = () => labelCanvas.clientWidth / manifest.width;     // display px per map px
const fontStr = l => `${manifest.font.weight} ${l.size}px ${manifest.font.family}`;

function labelDefaults(l) {
  if (l.stroke == null) l.stroke = +(l.size * 0.11).toFixed(1);   // outline like the PSD
  if (l.strokeColor == null) l.strokeColor = '#000000';
  if (l.curve == null) l.curve = 0;
  if (l.hidden == null) l.hidden = false;
  if (l.track == null) l.track = 0;
  if (l.rot == null) l.rot = 0;
  return l;
}
// geometry shared by render, selection box and hit-test
function labelGeom(l) {
  measureCtx.font = fontStr(l);
  const sp = (l.track || 0) * l.size;
  const chars = [...l.text];
  const adv = chars.map(ch => measureCtx.measureText(ch).width);
  const W = (adv.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1)) || 1;
  const peak = ((l.curve || 0) / 100) * 0.14 * W;   // signed vertical amplitude of the arc
  const half = Math.abs(peak) / 2;                  // arc is centred → ±half around the baseline
  return { W, peak, half, adv, sp, chars };
}
function measureWidth(l) { return labelGeom(l).W; }

function drawOneLabel(cx, l) {
  const baseY = l.size * 0.8;            // place text top near y=0 (alphabetic baseline)
  cx.save();
  cx.translate(l.x, l.y); cx.rotate((l.rot || 0) * Math.PI / 180);
  cx.font = fontStr(l); cx.textBaseline = 'alphabetic';
  cx.lineJoin = 'round'; cx.miterLimit = 2;
  const stroke = l.stroke || 0;
  if (!l.curve) {
    cx.textAlign = 'left';
    if ('letterSpacing' in cx) cx.letterSpacing = ((l.track || 0) * l.size) + 'px';
    if (stroke > 0) { cx.strokeStyle = l.strokeColor; cx.lineWidth = stroke * 2; cx.strokeText(l.text, 0, baseY); }
    cx.fillStyle = l.color; cx.fillText(l.text, 0, baseY);
    if ('letterSpacing' in cx) cx.letterSpacing = '0px';
  } else {
    cx.textAlign = 'left';
    const { W, peak, adv, sp, chars } = labelGeom(l);
    let px = 0;
    for (let i = 0; i < chars.length; i++) {
      const cw = adv[i], mid = px + cw / 2, t = mid / W - 0.5;
      const yOff = peak * (1 - 4 * t * t) - peak / 2;   // centred arc: ±peak/2 around the baseline
      const ang = Math.atan(8 * peak * t / W);          // glyph tangent to the arc
      cx.save(); cx.translate(px, -yOff); cx.rotate(ang);
      if (stroke > 0) { cx.strokeStyle = l.strokeColor; cx.lineWidth = stroke * 2; cx.strokeText(chars[i], 0, baseY); }
      cx.fillStyle = l.color; cx.fillText(chars[i], 0, baseY);
      cx.restore();
      px += cw + sp;
    }
  }
  cx.restore();
}

function drawLabels(cx) { for (const l of labels) if (!l.hidden) drawOneLabel(cx, l); }

function renderLabels() {
  lctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  drawLabels(lctx);
  // selection box
  const l = labels.find(x => x.id === selectedId);
  if (l && !l.hidden && canEdit()) {
    const g = labelGeom(l), s = scale() || 0.1, lw = 2 / s, pad = l.size * 0.18;
    lctx.save();
    lctx.translate(l.x, l.y); lctx.rotate((l.rot || 0) * Math.PI / 180);
    lctx.strokeStyle = '#e0992f'; lctx.lineWidth = lw; lctx.setLineDash([lw * 3, lw * 2]);
    lctx.strokeRect(-pad, -g.half - pad, g.W + 2 * pad, l.size + 2 * g.half + 2 * pad);
    lctx.restore();
  }
}

function labelAt(mx, my) {                 // map-space point -> topmost label id
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i]; if (l.hidden) continue;
    const a = -(l.rot || 0) * Math.PI / 180;
    const dx = mx - l.x, dy = my - l.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    const g = labelGeom(l), pad = l.size * 0.2;
    if (lx >= -pad && lx <= g.W + pad && ly >= -g.half - pad && ly <= l.size + g.half + pad) return l.id;
  }
  return null;
}

function wireLabelCanvas() {
  const w = wrap();
  let mode = null, start = null;
  const toMap = e => { const r = labelCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * manifest.width, y: (e.clientY - r.top) / r.height * manifest.height }; };

  labelCanvas.addEventListener('pointerdown', e => {
    if ($('#labelEdit').dataset.active) return;
    const p = toMap(e);
    const hit = canEdit() ? labelAt(p.x, p.y) : null;
    if (hit) {
      select(hit);
      if (canMove()) { mode = 'drag'; const l = labels.find(x => x.id === hit); start = { x: e.clientX, y: e.clientY, ox: l.x, oy: l.y }; labelCanvas.setPointerCapture(e.pointerId); }
    } else {
      deselect();
      mode = 'pan'; start = { x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop };
      labelCanvas.setPointerCapture(e.pointerId); labelCanvas.style.cursor = 'grabbing';
    }
  });
  labelCanvas.addEventListener('pointermove', e => {
    if (mode === 'pan') { w.scrollLeft = start.sl - (e.clientX - start.x); w.scrollTop = start.st - (e.clientY - start.y); }
    else if (mode === 'drag') {
      const s = scale(), l = labels.find(x => x.id === selectedId); if (!l) return;
      l.x = Math.round(start.ox + (e.clientX - start.x) / s);
      l.y = Math.round(start.oy + (e.clientY - start.y) / s);
      renderLabels();
    }
  });
  const end = () => { if (mode === 'drag') persistLabels(); mode = null; labelCanvas.style.cursor = ''; };
  labelCanvas.addEventListener('pointerup', end);
  labelCanvas.addEventListener('pointercancel', end);
  labelCanvas.addEventListener('dblclick', e => {
    if (!canEdit()) return;
    const p = toMap(e); const hit = labelAt(p.x, p.y);
    if (hit) { select(hit); beginEdit(); }
  });
}

// inline text edit over the canvas
function beginEdit() {
  const l = labels.find(x => x.id === selectedId); if (!l || !canEdit()) return;
  const inp = $('#labelEdit'); inp.dataset.active = '1';
  const place = () => {
    const s = scale();
    inp.style.left = (l.x * s) + 'px'; inp.style.top = (l.y * s) + 'px';
    inp.style.fontSize = (l.size * s) + 'px'; inp.style.transform = `rotate(${l.rot || 0}deg)`;
    inp.style.color = l.color; inp.style.letterSpacing = (l.track || 0) + 'em';
  };
  inp._place = place; place();
  inp.value = l.text; inp.classList.remove('hidden'); inp.focus(); inp.select();
  const oninput = () => { l.text = inp.value; renderLabels(); };
  const finish = () => {
    l.text = inp.value || 'Label'; inp.classList.add('hidden'); inp.dataset.active = '';
    inp.removeEventListener('input', oninput); inp.removeEventListener('blur', finish); inp.removeEventListener('keydown', onkey);
    persistLabels(); renderLabels(); buildLabelList(); buildLabelEditor();
  };
  const onkey = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } if (e.key === 'Escape') inp.blur(); };
  inp.addEventListener('input', oninput); inp.addEventListener('blur', finish); inp.addEventListener('keydown', onkey);
}

function select(id) { selectedId = id; renderLabels(); buildLabelEditor(); markListSel(); }
function deselect() { selectedId = null; renderLabels(); buildLabelEditor(); markListSel(); }
function markListSel() { document.querySelectorAll('.lrow').forEach(r => r.classList.toggle('sel', r.dataset.id === selectedId)); }

function centerOnLabel(l) { const w = wrap(), s = scale(); w.scrollLeft = l.x * s - w.clientWidth / 2; w.scrollTop = l.y * s - w.clientHeight / 2; }

// ---------- Text tab: selected-label editor + list ----------
function buildLabelEditor() {
  const box = $('#labelEditor');
  const l = labels.find(x => x.id === selectedId);
  if (!l) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="lehead"><b>Selected label</b><button id="leDel" class="del">🗑 Delete</button></div>
    <label>Text</label><input type="text" id="leText" value="${escapeHtml(l.text)}">
    <div class="grid">
      <div class="field"><label>Size <span class="val" id="leSizeV"></span></label><input type="range" id="leSize" min="8" max="200" step="1"></div>
      <div class="field"><label>Rotate <span class="val" id="leRotV"></span></label><input type="range" id="leRot" min="-180" max="180" step="1"></div>
      <div class="field"><label>Curve <span class="val" id="leCurveV"></span></label><input type="range" id="leCurve" min="-100" max="100" step="1"></div>
      <div class="field"><label>Outline <span class="val" id="leStrokeV"></span></label><input type="range" id="leStroke" min="0" max="40" step="0.5"></div>
    </div>
    <div class="rowflex">
      <label style="margin:0">Fill</label><input type="color" id="leColor">
      <label style="margin:0">Outline</label><input type="color" id="leStrokeColor">
      <label style="margin:0 0 0 auto"><input type="checkbox" id="leHide"> hide</label>
    </div>
    <div class="movehint">${canMove() ? 'Drag on the map to move • double-click to edit text' : (serverMode ? 'Moving requires admin mode' : '')}</div>`;
  const set = (k, v) => { l[k] = v; persistLabels(); renderLabels(); };
  const sz = $('#leSize'), rot = $('#leRot'), cur = $('#leCurve'), st = $('#leStroke');
  sz.value = l.size; rot.value = l.rot || 0; cur.value = l.curve || 0; st.value = l.stroke || 0;
  const vals = () => { $('#leSizeV').textContent = Math.round(l.size); $('#leRotV').textContent = (l.rot || 0) + '°'; $('#leCurveV').textContent = (l.curve || 0); $('#leStrokeV').textContent = (l.stroke || 0); };
  vals();
  $('#leText').oninput = e => { l.text = e.target.value; persistLabels(); renderLabels(); updateListName(l); };
  sz.oninput = e => { set('size', +e.target.value); vals(); };
  rot.oninput = e => { set('rot', +e.target.value); vals(); };
  cur.oninput = e => { set('curve', +e.target.value); vals(); };
  st.oninput = e => { set('stroke', +e.target.value); vals(); };
  $('#leColor').value = l.color; $('#leColor').oninput = e => set('color', e.target.value);
  $('#leStrokeColor').value = l.strokeColor || '#000000'; $('#leStrokeColor').oninput = e => set('strokeColor', e.target.value);
  $('#leHide').checked = !!l.hidden; $('#leHide').onchange = e => { l.hidden = e.target.checked; persistLabels(); renderLabels(); buildLabelList(); };
  $('#leDel').onclick = () => deleteLabel(l.id);
}

function updateListName(l) { const r = document.querySelector(`.lrow[data-id="${l.id}"] .lname`); if (r) r.textContent = l.text || '(empty)'; }

function buildLabelList() {
  const box = $('#labelList'); if (!box) return;
  if (!labels.length) { box.innerHTML = '<div class="empty">No text labels yet. Use ＋ Add.</div>'; return; }
  box.innerHTML = '';
  for (const l of labels) {
    const row = document.createElement('div');
    row.className = 'lrow' + (l.hidden ? ' hidden-lbl' : '') + (l.id === selectedId ? ' sel' : '');
    row.dataset.id = l.id;
    row.innerHTML = `<span class="lname">${escapeHtml(l.text) || '(empty)'}</span>
      <button class="lhide" title="${l.hidden ? 'Show' : 'Hide'}">${l.hidden ? '🚫' : '👁'}</button>
      <button class="ldel" title="Delete">🗑</button>`;
    row.onclick = e => { if (e.target.closest('button')) return; select(l.id); centerOnLabel(l); };
    row.querySelector('.lhide').onclick = () => { l.hidden = !l.hidden; persistLabels(); renderLabels(); buildLabelList(); if (l.id === selectedId) buildLabelEditor(); };
    row.querySelector('.ldel').onclick = () => deleteLabel(l.id);
    box.appendChild(row);
  }
}

function deleteLabel(id) {
  labels = labels.filter(x => x.id !== id); persistLabels();
  if (selectedId === id) selectedId = null;
  renderLabels(); buildLabelList(); buildLabelEditor();
}

function addLabel() {
  if (!canEdit()) return toast('Unlock editing first.');
  const id = 'L' + Date.now().toString(36);
  const l = labelDefaults({ id, text: 'New Label', x: Math.round(manifest.width * 0.42), y: Math.round(manifest.height * 0.46), size: 70, rot: 0, track: 0, color: '#ebebeb' });
  labels.push(l); persistLabels();
  // switch to text tab
  document.querySelector('.tab[data-tab=text]').click();
  renderLabels(); buildLabelList(); select(id); centerOnLabel(l); beginEdit();
}

// ---------- Quick recolor ----------
function buildQuick() {
  const sel = $('#quickSelect');
  sel.innerHTML = manifest.territories.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  const sync = () => { const t = manifest.territories.find(x => x.id == sel.value); const c = colorOf(t) || '#cc5500'; $('#quickColor').value = c; $('#quickHex').value = c; };
  sel.onchange = sync; sync();
  $('#quickColor').oninput = e => { $('#quickHex').value = e.target.value; };
  $('#quickHex').oninput = e => { if (/^#[0-9a-f]{6}$/i.test(e.target.value)) $('#quickColor').value = e.target.value; };
  $('#quickApply').onclick = () => {
    const hex = $('#quickHex').value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return toast('Enter a valid hex like #cc5500');
    setColor(+sel.value, hex.toLowerCase());
    toast(`${manifest.territories.find(t => t.id == sel.value).label} → ${hex}`);
  };
}

// ---------- Full territory list ----------
function buildList() {
  const list = $('#list'); list.innerHTML = '';
  for (const t of manifest.territories) {
    const row = document.createElement('div');
    row.className = 'row'; row.dataset.id = t.id; row.dataset.label = t.label.toLowerCase();
    row.innerHTML = `<span class="num">${t.id}</span><span class="label">${t.label}</span>
      <button class="sw" type="button" title="Pick colour"></button>
      <input class="hxcolor" type="color"><input class="hx" maxlength="7" title="Hex colour">
      <button class="clr" title="Reset to default">⟲</button>`;
    const sw = row.querySelector('.sw'); const ci = row.querySelector('.hxcolor'); const hx = row.querySelector('.hx');
    sw.onclick = () => ci.click();
    ci.oninput = () => setColor(t.id, ci.value);
    hx.onchange = () => { const v = hx.value.trim().toLowerCase(); if (v === '' || v === 'none') return setColor(t.id, null); if (!/^#[0-9a-f]{6}$/i.test(v)) return toast('Bad hex'); setColor(t.id, v); };
    row.querySelector('.clr').onclick = () => resetColor(t.id);
    list.appendChild(row); syncRow(t.id, row);
  }
  $('#filter').oninput = e => { const q = e.target.value.toLowerCase(); document.querySelectorAll('.row').forEach(r => r.style.display = (r.dataset.label.includes(q) || r.dataset.id.includes(q)) ? '' : 'none'); };
}
function syncRow(num, row) {
  row = row || document.querySelector(`.row[data-id="${num}"]`); if (!row) return;
  const t = manifest.territories.find(x => x.id == num); const hex = colorOf(t);
  const sw = row.querySelector('.sw'); const colorInput = row.querySelector('.hxcolor'); const hx = row.querySelector('.hx');
  if (hex) { sw.style.background = hex; colorInput.value = hex; hx.value = hex; hx.placeholder = ''; }
  else { sw.style.background = 'transparent'; hx.value = ''; hx.placeholder = 'none'; }
  row.classList.toggle('changed', isChanged(t));
  if ($('#quickSelect').value == num) { $('#quickColor').value = hex || '#cc5500'; $('#quickHex').value = hex || ''; }
}

// ---------- zoom & pan ----------
const wrap = () => $('.canvas-wrap');
const viewport = () => $('#viewport');
let zoom = 1;
function fitSize() { const w = wrap(); return Math.max(50, Math.min(w.clientWidth, w.clientHeight) - 4); }
function applyZoom() {
  const px = fitSize() * zoom; const vp = viewport();
  vp.style.width = px + 'px'; vp.style.height = px + 'px';
  const pct = $('#zoomPct'); if (pct) pct.textContent = Math.round(zoom * 100) + '%';
  const inp = $('#labelEdit'); if (inp.dataset.active && inp._place) inp._place();
  renderLabels();
}
function setZoom(z, cx, cy) {
  const w = wrap(), vp = viewport(); const old = zoom;
  zoom = Math.min(8, Math.max(1, z)); if (zoom === old) return;
  const r = vp.getBoundingClientRect();
  cx = cx ?? (r.left + r.width / 2); cy = cy ?? (r.top + r.height / 2);
  const fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
  applyZoom();
  const nr = vp.getBoundingClientRect();
  w.scrollLeft += (nr.left + fx * nr.width) - cx; w.scrollTop += (nr.top + fy * nr.height) - cy;
}
function wireZoom() {
  const w = wrap();
  w.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); }, { passive: false });
  $('#zoomIn').onclick = () => setZoom(zoom * 1.25);
  $('#zoomOut').onclick = () => setZoom(zoom / 1.25);
  $('#zoomReset').onclick = () => { zoom = 1; applyZoom(); w.scrollLeft = w.scrollTop = 0; };
}

// ---------- Export ----------
function renderOverlayOnly() {
  const c = document.createElement('canvas'); c.width = manifest.width; c.height = manifest.height;
  const cx = c.getContext('2d');
  paintTerritories(cx);
  if ($('#incLines').checked) cx.drawImage(linesImg, 0, 0);
  if ($('#incNames').checked) drawLabels(cx);
  return c;
}
function wireButtons() {
  $('#btnAddText').onclick = addLabel;
  $('#btnAddText2').onclick = addLabel;
  $('#btnPng').onclick = async () => {
    await document.fonts.ready;
    renderOverlayOnly().toBlob(b => downloadBlob(b, 'NH_Territories_overlay.png'), 'image/png');
    toast('Transparent overlay downloaded.');
  };
  $('#btnResetAll').onclick = () => {
    if (!confirm('Reset territory colours AND text labels back to the original map?')) return;
    state = {}; persist(); render();
    manifest.territories.forEach(t => syncRow(t.id));
    labels = manifest.labels.map(l => labelDefaults({ ...l })); persistLabels(); selectedId = null;
    renderLabels(); buildLabelList(); buildLabelEditor();
    toast('Everything reset to defaults.');
  };
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- server UI / modals ----------
function wireServerUI() {
  const modalEl = $('#modal');
  modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  if (!serverMode) return;
  for (const id of ['#verBadge', '#btnHistory', '#btnEdit', '#sep1']) $(id).classList.remove('hidden');
  updateVerBadge();
  $('#btnEdit').onclick = () => editMode ? openSave() : openUnlock();
  $('#btnHistory').onclick = openHistory;
  $('#btnAdmin').onclick = openAdmin;
  window.addEventListener('focus', maybeRefresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybeRefresh(); });
  fetch('/api/config').then(r => r.json()).then(c => { if (c.usingDefaults) toast('Heads up: default passwords are active — change them in ⚙'); }).catch(() => {});
}
function updateVerBadge() { const v = currentVersion; $('#verBadge').innerHTML = v ? `<b>v${v.version}</b> · ${new Date(v.ts).toLocaleString()} · ${escapeHtml(v.editor)}` : 'no version saved yet'; }
const modal = html => { $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden'); };
const closeModal = () => { $('#modal').classList.add('hidden'); $('#sheet').innerHTML = ''; };

function openUnlock() {
  modal(`<h3>Enter edit password</h3><label>Password</label><input type="password" id="mPw" autofocus>
    <div class="err" id="mErr"></div><div class="btns"><button id="mCancel">Cancel</button><button class="primary" id="mOk">Unlock</button></div>`);
  $('#mCancel').onclick = closeModal;
  const go = async () => {
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('#mPw').value }) });
      if (!r.ok) { $('#mErr').textContent = 'Wrong password'; return; }
      authLevel = (await r.json()).level; editPassword = $('#mPw').value;
      closeModal(); setEditMode(true); toast(`Editing unlocked (${authLevel}).`);
    } catch { $('#mErr').textContent = 'Network error'; }
  };
  $('#mOk').onclick = go; $('#mPw').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
function openSave() {
  modal(`<h3>Save new version</h3><label>Your name (recorded on this version)</label><input type="text" id="mName" value="${escapeHtml(editorName)}" placeholder="e.g. Bastion">
    <label>Note (optional)</label><input type="text" id="mNote" placeholder="what changed">
    <div class="err" id="mErr"></div><div class="btns"><button id="mCancel">Cancel</button><button class="primary" id="mOk">Save version</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    editorName = $('#mName').value.trim() || 'unknown'; $('#mOk').disabled = true;
    try {
      try {
        const cur = await (await fetch('/api/state', { cache: 'no-store' })).json();
        const sv = cur.latest ? cur.latest.version : 0;
        if (sv > loadedVersion && !confirm(`v${sv} was saved by ${cur.latest.editor} while you were editing.\n\nSaving now creates v${sv + 1} from what's on your screen — their changes won't be merged in.\n\nSave anyway?`)) { $('#mOk').disabled = false; return; }
      } catch {}
      const r = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json', 'x-map-password': editPassword }, body: JSON.stringify({ state, labels, editor: editorName, note: $('#mNote').value.trim() }) });
      if (!r.ok) { $('#mErr').textContent = (await r.json()).error || 'Save failed'; $('#mOk').disabled = false; return; }
      const m = await r.json(); currentVersion = { version: m.version, ts: m.ts, editor: m.editor };
      loadedVersion = m.version; viewingOld = null; hideBanner();
      updateVerBadge(); closeModal(); toast(`Saved as v${m.version}.`);
    } catch { $('#mErr').textContent = 'Network error'; $('#mOk').disabled = false; }
  };
}
async function openHistory() {
  modal(`<h3>Version history</h3><div class="vlist" id="vlist">Loading…</div><div class="btns"><button id="mCancel">Close</button></div>`);
  $('#mCancel').onclick = closeModal;
  try {
    const { versions } = await (await fetch('/api/versions', { cache: 'no-store' })).json();
    if (!versions.length) { $('#vlist').textContent = 'No saved versions yet.'; return; }
    $('#vlist').innerHTML = versions.map(v => `<div class="vrow ${currentVersion && v.version === currentVersion.version ? 'cur' : ''}">
        <div class="vmeta"><div class="vt">v${v.version}${v.note ? ' — ' + escapeHtml(v.note) : ''}</div>
          <div class="vs">${new Date(v.ts).toLocaleString()} · ${escapeHtml(v.editor)}</div></div>
        <button data-v="${v.version}" class="vView">View</button>
        ${editMode ? `<button data-v="${v.version}" class="vRestore primary">Restore</button>` : ''}</div>`).join('');
    $('#vlist').querySelectorAll('.vView').forEach(b => b.onclick = () => viewVersion(b.dataset.v));
    $('#vlist').querySelectorAll('.vRestore').forEach(b => b.onclick = () => restoreVersion(b.dataset.v));
  } catch { $('#vlist').textContent = 'Failed to load history.'; }
}
async function viewVersion(id) {
  try {
    const { version } = await (await fetch('/api/versions/' + id)).json();
    state = version.state || {}; labels = (version.labels || []).map(l => labelDefaults({ ...l })); selectedId = null;
    refreshAll(); closeModal();
    const isLatest = currentVersion && +id === currentVersion.version;
    if (isLatest) { viewingOld = null; hideBanner(); } else { viewingOld = { version: +id }; showOldBanner(+id); }
  } catch { toast('Failed to load version.'); }
}
function showOldBanner(v) { const el = $('#verBanner'); el.innerHTML = `Previewing <b>v${v}</b> — not the latest. <button id="bnLatest" class="primary">Back to latest</button>`; el.classList.remove('hidden'); $('#bnLatest').onclick = backToLatest; }
function hideBanner() { $('#verBanner').classList.add('hidden'); }
async function backToLatest() { await loadFromServer(); viewingOld = null; hideBanner(); selectedId = null; refreshAll(); updateVerBadge(); toast('Back to the latest version.'); }
async function maybeRefresh() {
  if (!serverMode || editMode || viewingOld || !$('#modal').classList.contains('hidden')) return;
  try {
    const { latest } = await (await fetch('/api/state', { cache: 'no-store' })).json();
    if (latest && latest.version !== (currentVersion && currentVersion.version)) {
      state = latest.state || {}; labels = (latest.labels || []).map(l => labelDefaults({ ...l }));
      currentVersion = { version: latest.version, ts: latest.ts, editor: latest.editor }; loadedVersion = latest.version; selectedId = null;
      refreshAll(); updateVerBadge(); toast(`Updated to v${latest.version} (${latest.editor}).`);
    }
  } catch {}
}
async function restoreVersion(id) {
  if (!confirm(`Restore v${id} as the new latest version? This creates a new version.`)) return;
  try {
    const r = await fetch('/api/restore', { method: 'POST', headers: { 'content-type': 'application/json', 'x-map-password': editPassword }, body: JSON.stringify({ version: +id, editor: editorName || 'unknown' }) });
    if (!r.ok) { toast((await r.json()).error || 'Restore failed'); return; }
    const m = await r.json(); currentVersion = { version: m.version, ts: m.ts, editor: m.editor };
    const { version } = await (await fetch('/api/versions/' + m.version)).json();
    state = version.state || {}; labels = (version.labels || []).map(l => labelDefaults({ ...l }));
    loadedVersion = m.version; viewingOld = null; hideBanner(); selectedId = null;
    refreshAll(); updateVerBadge(); closeModal(); toast(`Restored as v${m.version}.`);
  } catch { toast('Network error'); }
}
function openAdmin() {
  modal(`<h3>Admin settings</h3><p style="font-size:12px;color:var(--muted);margin:0">Change passwords. Leave a field blank to keep it.</p>
    <label>New admin password</label><input type="password" id="aAdmin"><label>New editor password</label><input type="password" id="aEditor">
    <div class="err" id="mErr"></div><div class="btns"><button id="mCancel">Cancel</button><button class="primary" id="mOk">Update</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mOk').onclick = async () => {
    const newAdmin = $('#aAdmin').value, newEditor = $('#aEditor').value;
    if (!newAdmin && !newEditor) return closeModal();
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-map-password': editPassword }, body: JSON.stringify({ newAdmin, newEditor }) });
      if (!r.ok) { $('#mErr').textContent = (await r.json()).error || 'Failed'; return; }
      if (newAdmin) editPassword = newAdmin;
      closeModal(); toast('Passwords updated.');
    } catch { $('#mErr').textContent = 'Network error'; }
  };
}

let toastT;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }

init().catch(e => { console.error(e); document.body.innerHTML = '<p style="padding:40px;color:#e06b5a">Failed to load assets. Did you run <code>npm run bake</code>?<br>' + e.message + '</p>'; });
