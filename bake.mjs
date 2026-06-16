// bake.mjs — one-time (re-runnable) preprocessing of the big PSD into lightweight web assets.
// Outputs into public/assets/:  base.jpg, overlay.png, masks/<id>.png (inner-glow gradient), manifest.json
import { readPsd, initializeCanvas } from 'ag-psd';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Looks for the PSD next to / one level above this folder. Override with:
//   PSD_PATH="path/to/NH_TerritoryMap.psd" npm run bake
const PSD_PATH = process.env.PSD_PATH
  || (existsSync(join(__dirname, 'NH_TerritoryMap.psd'))
        ? join(__dirname, 'NH_TerritoryMap.psd')
        : join(__dirname, '..', 'NH_TerritoryMap.psd'));
const OUT_W = 6000;                 // full original resolution (1:1 with the source PSD)
const ASSETS = join(__dirname, 'public', 'assets');
const MASKS = join(ASSETS, 'masks');

initializeCanvas(createCanvas, (w, h) => new ImageData(w, h));

console.log('Reading PSD (this takes a few seconds)…');
console.time('parse');
const buf = readFileSync(PSD_PATH);
const psd = readPsd(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { skipThumbnail: true });
console.timeEnd('parse');

const DOC_W = psd.width, DOC_H = psd.height;
const SCALE = OUT_W / DOC_W;
const OUT_H = Math.round(DOC_H * SCALE);
console.log(`Doc ${DOC_W}x${DOC_H} -> output ${OUT_W}x${OUT_H} (scale ${SCALE})`);

// --- Flatten visible leaf layers in z-order (index 0 = bottom of stack) ---
const leaves = [];
(function walk(children, hiddenAncestor, topGroup) {
  for (const l of children || []) {
    const hidden = hiddenAncestor || !!l.hidden;
    const grp = topGroup ?? l.name;
    if (l.children) walk(l.children, hidden, grp);
    else leaves.push({ layer: l, hidden, topGroup: grp, z: leaves.length });
  }
})(psd.children, false, null);

const colorZ = leaves.filter(l => l.topGroup === 'Colors').map(l => l.z);
const colorsTop = Math.min(...colorZ), colorsBottom = Math.max(...colorZ);

// ag-psd lists bottom->top: layers before Colors (Layer 1 parchment) = BASE,
// layers after it (dashed borders, numbers, names) = OVERLAY drawn on top of the glows.
const baseLeaves    = leaves.filter(l => !l.hidden && l.z < colorsTop);
const overlayLeaves = leaves.filter(l => !l.hidden && l.z > colorsBottom);
console.log(`base layers: ${baseLeaves.length}, overlay layers: ${overlayLeaves.length}`);

function compositeToOut(set) {
  const full = createCanvas(DOC_W, DOC_H);
  const ctx = full.getContext('2d');
  for (const { layer } of [...set].sort((a, b) => b.z - a.z)) {  // bottom first
    if (!layer.canvas) continue;
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(layer.canvas, layer.left, layer.top);
  }
  ctx.globalAlpha = 1;
  const out = createCanvas(OUT_W, OUT_H);
  out.getContext('2d').drawImage(full, 0, 0, OUT_W, OUT_H);
  return out;
}

// clear generated files but keep public/assets/fonts/ (bundled font)
mkdirSync(ASSETS, { recursive: true });
rmSync(MASKS, { recursive: true, force: true });
mkdirSync(MASKS, { recursive: true });
for (const f of ['base.jpg', 'overlay-lines.png', 'overlay-names.png', 'manifest.json'])
  rmSync(join(ASSETS, f), { force: true });

// base is the editor's preview backdrop only (never in the exported overlay), so compress it hard
console.log('Rendering base (parchment) → base.jpg …');
writeFileSync(join(ASSETS, 'base.jpg'), compositeToOut(baseLeaves).toBuffer('image/jpeg', 80));

// Borders + numbers stay a baked image; the place names become live editable text (below).
const linesLeaves = overlayLeaves.filter(l => l.topGroup !== 'Name markings');
console.log('Rendering borders+numbers → overlay-lines.png …');
writeFileSync(join(ASSETS, 'overlay-lines.png'), compositeToOut(linesLeaves).toBuffer('image/png'));

// --- Extract place-name text layers as editable labels ---
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const labels = [];
function collectText(children) {
  for (const l of children || []) {
    if (l.children) { collectText(l.children); continue; }
    if (!l.text) continue;
    const tr = l.text.transform || [1, 0, 0, 1, 0, 0];
    const [a, b, , , tx, ty] = tr;
    const scale = Math.hypot(a, b) || 1;
    const angle = Math.atan2(b, a) * 180 / Math.PI;
    const style = l.text.style || (l.text.styleRuns && l.text.styleRuns[0] && l.text.styleRuns[0].style) || {};
    const col = style.fillColor || { r: 235, g: 235, b: 235 };
    const sizeDoc = (style.fontSize || 33) * scale;
    labels.push({
      id: 'L' + labels.length,
      text: l.text.text,
      x: +(tx * SCALE).toFixed(1),
      y: +((ty - 0.8 * sizeDoc) * SCALE).toFixed(1),  // baseline -> top of text
      size: +(sizeDoc * SCALE).toFixed(1),
      rot: +angle.toFixed(2),
      track: +((style.tracking || 0) / 1000).toFixed(4),  // PSD tracking (1/1000 em) -> em
      color: hex(col),
    });
  }
}
const namesTop = psd.children.find(c => c.name === 'Name markings');
collectText(namesTop?.children);
console.log(`Extracted ${labels.length} editable text labels.`);

// --- Inner-glow gradient: distance transform of the territory silhouette ---
// Two-pass chamfer distance-from-edge (distance to nearest pixel OUTSIDE the shape),
// then alpha = falloff over the glow size, peaking at the border, 0 in the interior.
function innerGlowAlpha(binary, w, h, sizePx) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = binary[i] ? INF : 0; // outside = 0 distance
  const D1 = 1, D2 = 1.41421356;
  // forward
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (d[i] === 0) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + D1);
    if (y > 0) m = Math.min(m, d[i - w] + D1);
    if (x > 0 && y > 0) m = Math.min(m, d[i - w - 1] + D2);
    if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + D2);
    d[i] = m;
  }
  // backward
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (d[i] === 0) continue;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + D1);
    if (y < h - 1) m = Math.min(m, d[i + w] + D1);
    if (x < w - 1 && y < h - 1) m = Math.min(m, d[i + w + 1] + D2);
    if (x > 0 && y < h - 1) m = Math.min(m, d[i + w - 1] + D2);
    d[i] = m;
  }
  // distance -> alpha: full at the edge, fading linearly to 0 by `sizePx` inward
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < d.length; i++) {
    if (!binary[i]) { out[i] = 0; continue; }
    const t = Math.max(0, 1 - d[i] / sizePx);   // 1 at border -> 0 deep inside
    out[i] = Math.round(255 * Math.pow(t, 1.15));
  }
  return out;
}

const colorsGroup = psd.children.find(c => c.name === 'Colors');
const hiddenSet = new Set(leaves.filter(l => l.hidden && l.topGroup === 'Colors').map(l => l.layer));
function parseName(name) {
  const m = name.match(/Territor?y\s+(\d+)\s*([A-Z])?/i);
  return m ? { num: parseInt(m[1], 10), sub: m[2] || '' } : null;
}

// Fallback for layers whose stored raster is empty (e.g. Territory 16): rasterize the
// vector mask path directly. Knot points are [ctrlIn_x, ctrlIn_y, anchor_x, anchor_y, ctrlOut_x, ctrlOut_y]
// in absolute document pixels.
function rasterizeVectorMask(layer, mw, mh) {
  const c = createCanvas(mw, mh);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  const sx = x => (x - layer.left) * SCALE, sy = y => (y - layer.top) * SCALE;
  for (const path of layer.vectorMask?.paths || []) {
    const k = path.knots; if (!k || !k.length) continue;
    ctx.beginPath();
    ctx.moveTo(sx(k[0].points[2]), sy(k[0].points[3]));
    for (let i = 0; i < k.length; i++) {
      const j = (i + 1) % k.length;
      ctx.bezierCurveTo(sx(k[i].points[4]), sy(k[i].points[5]),
                        sx(k[j].points[0]), sy(k[j].points[1]),
                        sx(k[j].points[2]), sy(k[j].points[3]));
    }
    ctx.closePath();
    ctx.fill();
  }
  const d = ctx.getImageData(0, 0, mw, mh).data;
  const bin = new Uint8Array(mw * mh);
  for (let p = 0; p < mw * mh; p++) bin[p] = d[p * 4 + 3] > 8 ? 1 : 0;
  return bin;
}

// build an inner-glow gradient mask PNG for a shape/vassal layer; returns its placement
function bakeMask(layer, id) {
  const lw = layer.right - layer.left, lh = layer.bottom - layer.top;
  if (lw <= 0 || lh <= 0 || !layer.canvas) return null;
  const mw = Math.max(1, Math.round(lw * SCALE)), mh = Math.max(1, Math.round(lh * SCALE));
  const tmp = createCanvas(mw, mh);
  tmp.getContext('2d').drawImage(layer.canvas, 0, 0, mw, mh);
  const src = tmp.getContext('2d').getImageData(0, 0, mw, mh).data;
  let binary = new Uint8Array(mw * mh), any = false;
  for (let p = 0; p < mw * mh; p++) { if (src[p * 4 + 3] > 8) { binary[p] = 1; any = true; } }
  if (!any && layer.vectorMask?.paths?.length) {
    binary = rasterizeVectorMask(layer, mw, mh);
    console.log(`  ${layer.name}: empty raster → rasterized vector mask`);
  }
  const glow = layer.effects?.innerGlow;
  const sizePx = Math.max(4, (glow?.size?.value ?? 135) * SCALE);
  const alpha = innerGlowAlpha(binary, mw, mh, sizePx);
  const outImg = new Uint8ClampedArray(mw * mh * 4);
  for (let p = 0; p < mw * mh; p++) { outImg[p * 4] = outImg[p * 4 + 1] = outImg[p * 4 + 2] = 255; outImg[p * 4 + 3] = alpha[p]; }
  const mc = createCanvas(mw, mh);
  mc.getContext('2d').putImageData(new ImageData(outImg, mw, mh), 0, 0);
  writeFileSync(join(MASKS, `${id}.png`), mc.toBuffer('image/png'));
  return { file: `masks/${id}.png`, x: Math.round(layer.left * SCALE), y: Math.round(layer.top * SCALE), w: mw, h: mh };
}

const territories = new Map();
function entryFor(num) {
  let e = territories.get(num);
  if (!e) {
    e = { id: num, label: `Territory ${num}`, opacity: 0.55, defaultHex: '#cccccc',
      hiddenByDefault: true, parts: [], vassalColor: '#4abf9d', vassalOpacity: 0.88, vassalParts: [] };
    territories.set(num, e);
  }
  return e;
}

// faction colour layers (Colors group)
for (const layer of colorsGroup.children) {
  const info = parseName(layer.name); if (!info) continue;
  const part = bakeMask(layer, `T${info.num}${info.sub}`); if (!part) continue;
  const e = entryFor(info.num);
  const glow = layer.effects?.innerGlow;
  if (glow?.enabled) { e.opacity = +(glow.opacity ?? 0.55).toFixed(3); if (glow.color) e.defaultHex = hex(glow.color); }
  if (!hiddenSet.has(layer)) e.hiddenByDefault = false;
  e.parts.push(part);
}

// vassal marker layers (Vassalizations group) — the teal "is a vassal" overlay, hidden by default
const vassalGroup = psd.children.find(c => c.name === 'Vassalizations');
let vassalCount = 0;
for (const layer of vassalGroup?.children || []) {
  const info = parseName(layer.name); if (!info) continue;
  const part = bakeMask(layer, `V${info.num}${info.sub}`); if (!part) continue;
  const e = entryFor(info.num);
  const glow = layer.effects?.innerGlow;
  if (glow) { e.vassalOpacity = +(glow.opacity ?? 0.88).toFixed(3); if (glow.color) e.vassalColor = hex(glow.color); }
  e.vassalParts.push(part); vassalCount++;
}
console.log(`Baked ${vassalCount} vassal masks.`);

const manifest = {
  width: OUT_W, height: OUT_H,
  base: 'base.jpg', overlayLines: 'overlay-lines.png',
  font: { family: 'Cinzel', weight: 700, file: 'fonts/Cinzel-Bold.ttf' },
  labels,
  territories: [...territories.values()].sort((a, b) => a.id - b.id),
};
writeFileSync(join(ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\nDone. ${manifest.territories.length} territories baked into public/assets/`);
