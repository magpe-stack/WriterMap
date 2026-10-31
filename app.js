(() => {
'use strict';

/* ============ Utilidades ============ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const sid = v => String(v == null ? '' : v).replace(/[^\w-]/g, '').slice(0, 40);

const KEY = 'writermap.v1';
const COLOR_NAMES = ['Neutro', 'Conflito', 'Cena', 'Ideia', 'Personagem', 'Local', 'Tema'];
const MINW = 80, MAXW = 520, DEFW = 170, MINK = 0.2, MAXK = 3;

const vp = $('#vp'), world = $('#world'), nodesEl = $('#nodes'), eg = $('#eg'), tmp = $('#tmp');
const panel = $('#panel'), titleIn = $('#title'), fileIn = $('#file');

/* ============ Estado ============ */
let store;            // { cur, maps: [] }
let map;              // mapa aberto
let sel = null;       // { t: 'n' | 'e', id }
let editing = null;   // { id, fresh }
let hist = [], hi = 0;
const els = new Map();

const N = id => map.nodes.find(n => n.id === id);
const hOf = n => { const el = els.get(n.id); return el ? el.offsetHeight : 56; };
const rectOf = n => ({ x: n.x, y: n.y, w: n.w, h: hOf(n) });

/* ============ Dados ============ */
function cleanMap(m) {
  m = m || {};
  const seen = new Set();
  const nodes = (Array.isArray(m.nodes) ? m.nodes : []).filter(n => n && typeof n === 'object').map(n => {
    let id = sid(n.id) || uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    return {
      id, x: Math.round(+n.x || 0), y: Math.round(+n.y || 0),
      w: clamp(Math.round(+n.w || DEFW), MINW, MAXW),
      text: String(n.text == null ? '' : n.text).slice(0, 5000),
      c: clamp(parseInt(n.c, 10) || 0, 0, 6)
    };
  });
  const ids = new Set(nodes.map(n => n.id));
  const pairs = new Set(), eseen = new Set();
  const edges = [];
  (Array.isArray(m.edges) ? m.edges : []).forEach(e => {
    if (!e) return;
    const f = sid(e.from), t = sid(e.to);
    if (!ids.has(f) || !ids.has(t) || f === t) return;
    const k = [f, t].sort().join('|');
    if (pairs.has(k)) return;
    pairs.add(k);
    let id = sid(e.id) || uid();
    while (eseen.has(id)) id = uid();
    eseen.add(id);
    edges.push({ id, from: f, to: t });
  });
  let view = null;
  if (m.view && isFinite(+m.view.x) && isFinite(+m.view.y) && isFinite(+m.view.k)) {
    view = { x: +m.view.x, y: +m.view.y, k: clamp(+m.view.k, MINK, MAXK) };
  }
  return { id: sid(m.id) || uid(), name: String(m.name || 'Sem título').slice(0, 80), nodes, edges, view, updated: +m.updated || Date.now() };
}

function starter() {
  const mk = (x, y, text, c) => ({ id: uid(), x, y, w: DEFW, text, c });
  const a = mk(0, 0, 'Minha história', 0);
  const b = mk(290, -150, 'Personagens', 4);
  const c = mk(290, -20, 'Cenário e época', 5);
  const d = mk(290, 110, 'Trama', 2);
  const e = mk(580, 40, 'Começo', 2);
  const f = mk(580, 110, 'Conflito central', 1);
  const g = mk(580, 180, 'Desfecho', 2);
  const E = (p, q) => ({ id: uid(), from: p.id, to: q.id });
  return {
    id: uid(), name: 'Minha primeira história',
    nodes: [a, b, c, d, e, f, g],
    edges: [E(a, b), E(a, c), E(a, d), E(d, e), E(d, f), E(d, g)],
    view: null, updated: Date.now()
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.maps) && s.maps.length) {
      s.maps = s.maps.map(cleanMap);
      if (!s.maps.some(m => m.id === s.cur)) s.cur = s.maps[0].id;
      return s;
    }
  } catch (_) { /* sem dados salvos */ }
  const m = starter();
  return { cur: m.id, maps: [m] };
}

let saveTimer = 0;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
function save() {
  clearTimeout(saveTimer);
  try {
    map.updated = Date.now();
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (_) { toast('Não foi possível salvar: armazenamento cheio ou bloqueado.'); }
}

/* ============ Histórico (desfazer / refazer) ============ */
const snap = () => JSON.stringify({ n: map.nodes, e: map.edges });
function resetHist() { hist = [snap()]; hi = 0; }
function commit() {
  const s = snap();
  if (s === hist[hi]) { save(); updUI(); return; }
  hist = hist.slice(0, hi + 1);
  hist.push(s);
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1;
  save(); updUI();
}
function restore(i) {
  const o = JSON.parse(hist[i]);
  map.nodes = o.n; map.edges = o.e;
  if (sel && !(sel.t === 'n' ? N(sel.id) : map.edges.some(e => e.id === sel.id))) sel = null;
  render(); save();
}
function undo() { endEdit(); if (hi > 0) { hi--; restore(hi); } }
function redo() { endEdit(); if (hi < hist.length - 1) { hi++; restore(hi); } }

/* ============ Renderização ============ */
let raf = 0;
function schedEdges() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderEdges(); }); }
const ro = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(schedEdges)
  : { observe() {}, unobserve() {}, disconnect() {} };

function mkNode(n) {
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = n.id;
  el.innerHTML = '<div class="txt" data-ph="Novo nó" spellcheck="false"></div>' +
    '<div class="ln" title="Arraste para ligar a outra caixa"></div>' +
    '<div class="rs" title="Redimensionar"></div>';
  return el;
}

function renderNodes() {
  const seen = new Set();
  for (const n of map.nodes) {
    seen.add(n.id);
    let el = els.get(n.id);
    if (!el) { el = mkNode(n); els.set(n.id, el); nodesEl.appendChild(el); ro.observe(el); }
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.style.width = n.w + 'px';
    el.dataset.c = n.c;
    const txt = el.firstChild;
    if (!(editing && editing.id === n.id) && txt.textContent !== n.text) txt.textContent = n.text;
    el.classList.toggle('sel', !!(sel && sel.t === 'n' && sel.id === n.id));
  }
  for (const [id, el] of els) {
    if (!seen.has(id)) { ro.unobserve(el); el.remove(); els.delete(id); }
  }
}

function pathFor(A, B) {
  const ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 };
  const cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const horiz = Math.abs(dx) / (((A.w + B.w) / 2) || 1) >= Math.abs(dy) / (((A.h + B.h) / 2) || 1);
  let p1, p2, d1, d2;
  if (horiz) {
    const s = dx >= 0 ? 1 : -1;
    p1 = { x: s > 0 ? A.x + A.w : A.x, y: ca.y };
    p2 = { x: s > 0 ? B.x : B.x + B.w, y: cb.y };
    d1 = { x: s, y: 0 }; d2 = { x: -s, y: 0 };
  } else {
    const s = dy >= 0 ? 1 : -1;
    p1 = { x: ca.x, y: s > 0 ? A.y + A.h : A.y };
    p2 = { x: cb.x, y: s > 0 ? B.y : B.y + B.h };
    d1 = { x: 0, y: s }; d2 = { x: 0, y: -s };
  }
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const o = clamp(dist * 0.45, 30, 220);
  const r = v => Math.round(v * 10) / 10;
  return 'M' + r(p1.x) + ' ' + r(p1.y) +
    'C' + r(p1.x + d1.x * o) + ' ' + r(p1.y + d1.y * o) + ' ' +
    r(p2.x + d2.x * o) + ' ' + r(p2.y + d2.y * o) + ' ' + r(p2.x) + ' ' + r(p2.y);
}

function renderEdges() {
  let h = '';
  for (const e of map.edges) {
    const a = N(e.from), b = N(e.to);
    if (!a || !b) continue;
    const d = pathFor(rectOf(a), rectOf(b));
    const s = !!(sel && sel.t === 'e' && sel.id === e.id);
    h += '<g class="edge' + (s ? ' sel' : '') + '" data-id="' + e.id + '"><path class="hit" d="' + d +
      '"/><path class="vis" d="' + d + '" marker-end="url(#' + (s ? 'arS' : 'ar') + ')"/></g>';
  }
  eg.innerHTML = h;
}

function updUI() {
  const hasN = !!(sel && sel.t === 'n'), hasE = !!(sel && sel.t === 'e');
  $$('[data-for="n"]').forEach(x => x.hidden = !hasN);
  $$('[data-for="e"]').forEach(x => x.hidden = !hasE);
  $$('[data-for="s"]').forEach(x => x.hidden = !sel);
  const cur = hasN ? N(sel.id) : null;
  $$('.sw').forEach(b => b.classList.toggle('on', !!cur && cur.c === +b.dataset.c));
  $('#b-undo').disabled = hi <= 0;
  $('#b-redo').disabled = hi >= hist.length - 1;
  $('#empty').hidden = map.nodes.length > 0;
  if (document.activeElement !== titleIn) titleIn.value = map.name;
}

function render() { renderNodes(); renderEdges(); updUI(); applyView(); }
function select(t, id) { sel = t ? { t, id } : null; renderNodes(); renderEdges(); updUI(); }

/* ============ Câmera (pan / zoom) ============ */
function applyView() {
  const v = map.view;
  world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.k + ')';
  const g = 24 * v.k;
  vp.style.backgroundSize = g + 'px ' + g + 'px';
  vp.style.backgroundPosition = v.x + 'px ' + v.y + 'px';
  $('#zl').textContent = Math.round(v.k * 100) + '%';
  saveSoon();
}
function toWorld(cx, cy) {
  const r = vp.getBoundingClientRect(), v = map.view;
  return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
}
function zoomAt(cx, cy, nk) {
  nk = clamp(nk, MINK, MAXK);
  const r = vp.getBoundingClientRect(), w = toWorld(cx, cy);
  map.view = { k: nk, x: cx - r.left - w.x * nk, y: cy - r.top - w.y * nk };
  applyView();
}
function animate() {
  world.classList.add('anim');
  clearTimeout(animate.t);
  animate.t = setTimeout(() => world.classList.remove('anim'), 260);
}
function fitView() {
  const r = vp.getBoundingClientRect();
  animate();
  if (!map.nodes.length) { map.view = { x: r.width / 2, y: r.height / 2, k: 1 }; applyView(); return; }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const n of map.nodes) {
    const b = rectOf(n);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  const top = 70, bot = 80, pad = 40;
  const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1);
  const availH = r.height - top - bot;
  const k = clamp(Math.min((r.width - pad * 2) / bw, (availH - pad) / bh, 1.5), MINK, MAXK);
  map.view = { k, x: (r.width - bw * k) / 2 - x1 * k, y: top + (availH - bh * k) / 2 - y1 * k };
  applyView();
}

vp.addEventListener('wheel', e => {
  e.preventDefault();
  let dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  dy = clamp(dy, -300, 300);
  zoomAt(e.clientX, e.clientY, map.view.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
}, { passive: false });

/* ============ Criação / edição de caixas ============ */
function newNode(x, y, c, text) {
  const n = { id: uid(), x: Math.round(x), y: Math.round(y), w: DEFW, text: text || '', c: c || 0 };
  map.nodes.push(n);
  return n;
}
function overlaps(n) {
  const h = 56;
  return map.nodes.some(o => o !== n &&
    n.x < o.x + o.w + 16 && n.x + n.w + 16 > o.x &&
    n.y < o.y + hOf(o) + 16 && n.y + h + 16 > o.y);
}
function freeSpot(n) { let g = 0; while (g++ < 300 && overlaps(n)) n.y += 70; }

function addEdge(from, to) {
  if (from === to || !N(from) || !N(to)) return null;
  if (map.edges.some(e => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return null;
  const e = { id: uid(), from, to };
  map.edges.push(e);
  return e;
}

function addRoot() {
  endEdit();
  const r = vp.getBoundingClientRect();
  const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
  const n = newNode(p.x - DEFW / 2, p.y - 28, 0);
  freeSpot(n);
  select('n', n.id);
  render();
  startEdit(n.id, true);
}
function addChild(p) {
  if (!p) return;
  endEdit();
  const n = newNode(p.x + p.w + 70, p.y, p.c);
  freeSpot(n);
  addEdge(p.id, n.id);
  select('n', n.id);
  render();
  startEdit(n.id, true);
}
function addSibling(n) {
  if (!n) return;
  endEdit();
  const pe = map.edges.find(e => e.to === n.id);
  if (pe && N(pe.from)) return addChild(N(pe.from));
  const s = newNode(n.x, n.y + hOf(n) + 30, n.c);
  freeSpot(s);
  select('n', s.id);
  render();
  startEdit(s.id, true);
}
function delSel() {
  if (!sel) return;
  endEdit();
  if (sel.t === 'n') {
    const id = sel.id;
    map.nodes = map.nodes.filter(n => n.id !== id);
    map.edges = map.edges.filter(e => e.from !== id && e.to !== id);
  } else {
    const id = sel.id;
    map.edges = map.edges.filter(e => e.id !== id);
  }
  sel = null;
  render(); commit();
}
function setColor(c) {
  if (!sel || sel.t !== 'n') return;
  const n = N(sel.id);
  if (!n || n.c === c) return;
  n.c = c; render(); commit();
}
function flipEdge() {
  if (!sel || sel.t !== 'e') return;
  const e = map.edges.find(x => x.id === sel.id);
  if (!e) return;
  const t = e.from; e.from = e.to; e.to = t;
  render(); commit();
}

function startEdit(id, fresh) {
  if (editing && editing.id === id) return;
  if (editing) endEdit();
  const el = els.get(id), n = N(id);
  if (!el || !n) return;
  editing = { id, fresh: !!fresh };
  const t = el.firstChild;
  el.classList.add('editing');
  t.contentEditable = 'true';
  t.spellcheck = true;
  t.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(t);
  if (n.text && !fresh) range.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges(); s.addRange(range);
}
function endEdit() {
  if (!editing) return;
  const { id, fresh } = editing;
  editing = null;
  const el = els.get(id), n = N(id);
  if (!el || !n) return;
  const t = el.firstChild;
  const v = t.innerText.replace(/\r/g, '').trim().slice(0, 5000);
  t.contentEditable = 'false';
  t.spellcheck = false;
  el.classList.remove('editing');
  const s = window.getSelection();
  if (s) s.removeAllRanges();
  if (fresh && !v) {
    map.nodes = map.nodes.filter(x => x.id !== id);
    map.edges = map.edges.filter(e => e.from !== id && e.to !== id);
    if (sel && sel.id === id) sel = null;
  } else {
    n.text = v;
    t.textContent = v;
  }
  render(); commit();
}

nodesEl.addEventListener('focusout', e => {
  if (editing && e.target.classList && e.target.classList.contains('txt')) {
    setTimeout(() => {
      if (!editing) return;
      const el = els.get(editing.id);
      if (!el || el.firstChild !== document.activeElement) endEdit();
    }, 0);
  }
});
nodesEl.addEventListener('paste', e => {
  if (!e.target.closest || !e.target.closest('.txt')) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});
nodesEl.addEventListener('drop', e => e.preventDefault());

/* ============ Ponteiros (mouse, toque, caneta) ============ */
const ptrs = new Map();
let mode = null;
let tap = { id: null, t: 0 };

function hoverTarget(x, y, srcId) {
  const el = document.elementFromPoint(x, y);
  const nd = el && el.closest ? el.closest('.node') : null;
  $$('.node.target').forEach(n => n.classList.remove('target'));
  if (nd && nd.dataset.id !== srcId) nd.classList.add('target');
  return nd;
}

vp.addEventListener('pointerdown', e => {
  if (editing) {
    if (e.target.closest && e.target.closest('.node.editing')) return;
    endEdit();
  }
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
  const ae = document.activeElement;
  if (ae && ae !== document.body && ae.blur) ae.blur();
  e.preventDefault();
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { vp.setPointerCapture(e.pointerId); } catch (_) {}
  if (ptrs.size === 2) { startPinch(); return; }
  if (ptrs.size > 2) return;

  const t = e.target;
  const nodeEl = t.closest ? t.closest('.node') : null;
  if (nodeEl) {
    const id = nodeEl.dataset.id, n = N(id);
    if (!n) return;
    select('n', id);
    if (t.classList.contains('ln')) {
      mode = { m: 'link', id, moved: false, sx: e.clientX, sy: e.clientY };
      vp.classList.add('linking');
    } else if (t.classList.contains('rs')) {
      mode = { m: 'rs', id, sx: e.clientX, w0: n.w, moved: false };
    } else {
      mode = { m: 'node', id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
    }
    return;
  }
  const g = t.closest ? t.closest('.edge') : null;
  if (g) { select('e', g.dataset.id); mode = { m: 'tap' }; return; }
  select(null);
  mode = { m: 'pan', sx: e.clientX, sy: e.clientY, vx: map.view.x, vy: map.view.y, moved: false };
});

vp.addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!mode) return;
  const v = map.view;
  if (mode.m === 'pan') {
    const dx = e.clientX - mode.sx, dy = e.clientY - mode.sy;
    if (!mode.moved && Math.hypot(dx, dy) < 3) return;
    mode.moved = true;
    v.x = mode.vx + dx; v.y = mode.vy + dy;
    applyView();
  } else if (mode.m === 'node') {
    const dx = e.clientX - mode.sx, dy = e.clientY - mode.sy;
    if (!mode.moved && Math.hypot(dx, dy) < 4) return;
    const n = N(mode.id), el = els.get(mode.id);
    if (!n || !el) return;
    if (!mode.moved) { mode.moved = true; el.classList.add('drag'); }
    n.x = Math.round(mode.ox + dx / v.k);
    n.y = Math.round(mode.oy + dy / v.k);
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    renderEdges();
  } else if (mode.m === 'rs') {
    const n = N(mode.id), el = els.get(mode.id);
    if (!n || !el) return;
    const dx = e.clientX - mode.sx;
    if (!mode.moved && Math.abs(dx) < 3) return;
    mode.moved = true;
    n.w = clamp(Math.round(mode.w0 + dx / v.k), MINW, MAXW);
    el.style.width = n.w + 'px';
    renderEdges();
  } else if (mode.m === 'link') {
    if (!mode.moved && Math.hypot(e.clientX - mode.sx, e.clientY - mode.sy) < 6) return;
    mode.moved = true;
    const a = N(mode.id);
    if (!a) return;
    const p = toWorld(e.clientX, e.clientY);
    tmp.setAttribute('d', pathFor(rectOf(a), { x: p.x, y: p.y, w: 0, h: 0 }));
    hoverTarget(e.clientX, e.clientY, mode.id);
  } else if (mode.m === 'pinch') {
    doPinch();
  }
});

function startPinch() {
  if (mode) {
    if (mode.m === 'node') { const el = els.get(mode.id); if (el) el.classList.remove('drag'); if (mode.moved) commit(); }
    if (mode.m === 'rs' && mode.moved) commit();
    if (mode.m === 'link') { tmp.setAttribute('d', ''); vp.classList.remove('linking'); $$('.node.target').forEach(n => n.classList.remove('target')); }
  }
  const [a, b] = [...ptrs.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const w = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
  mode = { m: 'pinch', d0: d, k0: map.view.k, wx: w.x, wy: w.y };
}
function doPinch() {
  const pts = [...ptrs.values()];
  if (pts.length < 2) return;
  const [a, b] = pts;
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  const r = vp.getBoundingClientRect();
  const k = clamp(mode.k0 * d / mode.d0, MINK, MAXK);
  map.view = { k, x: cx - r.left - mode.wx * k, y: cy - r.top - mode.wy * k };
  applyView();
}

function finishLink(m, e, cancel) {
  tmp.setAttribute('d', '');
  $$('.node.target').forEach(n => n.classList.remove('target'));
  if (cancel || !m.moved) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const tel = el && el.closest ? el.closest('.node') : null;
  if (tel) {
    if (tel.dataset.id === m.id) return;
    if (addEdge(m.id, tel.dataset.id)) { render(); commit(); }
    else toast('Essas caixas já estão ligadas.');
  } else {
    const p = toWorld(e.clientX, e.clientY);
    const src = N(m.id);
    const n = newNode(p.x - DEFW / 2, p.y - 20, src ? src.c : 0);
    addEdge(m.id, n.id);
    select('n', n.id);
    render();
    startEdit(n.id, true);
  }
}

function pointerEnd(e, cancel) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
  if (mode && mode.m === 'pinch') {
    if (ptrs.size < 2) mode = ptrs.size ? { m: 'idle' } : null;
    saveSoon();
    return;
  }
  if (ptrs.size === 0 && mode && mode.m === 'idle') { mode = null; return; }
  const m = mode;
  mode = null;
  vp.classList.remove('linking');
  if (!m) return;
  if (m.m === 'node') {
    const el = els.get(m.id);
    if (el) el.classList.remove('drag');
    if (m.moved) commit();
    else if (!cancel) {
      const now = Date.now();
      if (tap.id === m.id && now - tap.t < 380) { tap = { id: null, t: 0 }; startEdit(m.id); }
      else tap = { id: m.id, t: now };
    }
  } else if (m.m === 'rs') {
    if (m.moved) commit();
  } else if (m.m === 'link') {
    finishLink(m, e, cancel);
  } else if (m.m === 'pan') {
    saveSoon();
  }
}
vp.addEventListener('pointerup', e => pointerEnd(e, false));
vp.addEventListener('pointercancel', e => pointerEnd(e, true));
vp.addEventListener('dblclick', e => {
  const el = e.target.closest ? e.target.closest('.node') : null;
  if (el && !editing) { select('n', el.dataset.id); startEdit(el.dataset.id); }
});
vp.addEventListener('contextmenu', e => {
  if (!(e.target.closest && e.target.closest('.node.editing'))) e.preventDefault();
});
document.addEventListener('gesturestart', e => e.preventDefault());

/* ============ Teclado ============ */
document.addEventListener('keydown', e => {
  if (editing) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endEdit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); endEdit(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const id = editing.id;
      endEdit();
      if (N(id)) addChild(N(id));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && 'biu'.includes(e.key.toLowerCase())) e.preventDefault();
    return;
  }
  const tg = e.target;
  if (tg && tg.matches && tg.matches('input,textarea,select')) return;
  if (!panel.hidden) { if (e.key === 'Escape') closePanel(); return; }
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key === '0') { e.preventDefault(); fitView(); return; }
  if (mod) return;
  if (e.key === 'Tab') { e.preventDefault(); if (sel && sel.t === 'n') addChild(N(sel.id)); else addRoot(); }
  else if (e.key === 'Enter' && sel && sel.t === 'n') { e.preventDefault(); e.shiftKey ? addSibling(N(sel.id)) : startEdit(sel.id); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); delSel(); }
  else if (e.key === 'Escape') select(null);
});
titleIn.addEventListener('keydown', e => { if (e.key === 'Enter') titleIn.blur(); });
titleIn.addEventListener('change', () => {
  map.name = titleIn.value.trim().slice(0, 80) || 'Sem título';
  titleIn.value = map.name;
  save();
});

/* ============ Botões ============ */
document.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('[data-act]') : null;
  if (!b) return;
  const cx = vp.getBoundingClientRect().width / 2, cy = vp.getBoundingClientRect().height / 2;
  switch (b.dataset.act) {
    case 'add': addRoot(); break;
    case 'child': if (sel && sel.t === 'n') addChild(N(sel.id)); break;
    case 'sibling': if (sel && sel.t === 'n') addSibling(N(sel.id)); break;
    case 'edit': if (sel && sel.t === 'n') startEdit(sel.id); break;
    case 'color': setColor(+b.dataset.c); break;
    case 'flip': flipEdge(); break;
    case 'del': delSel(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'fit': fitView(); break;
    case 'zin': animate(); zoomAt(cx, cy, map.view.k * 1.25); break;
    case 'zout': animate(); zoomAt(cx, cy, map.view.k / 1.25); break;
    case 'menu': openPanel(); break;
  }
});

/* ============ Mapas, painel, importar/exportar ============ */
function openMap(id) {
  endEdit();
  const m = store.maps.find(x => x.id === id);
  if (!m) return;
  store.cur = id;
  map = m;
  sel = null;
  for (const el of els.values()) { ro.unobserve(el); el.remove(); }
  els.clear();
  const needFit = !map.view;
  if (needFit) map.view = { x: 0, y: 0, k: 1 };
  resetHist();
  render();
  if (needFit) fitView();
  save();
}
function newMap() {
  const m = cleanMap({ name: 'Mapa ' + (store.maps.length + 1), nodes: [{ id: uid(), x: 0, y: 0, w: DEFW, text: 'Ideia central', c: 0 }] });
  m.view = null;
  store.maps.push(m);
  openMap(m.id);
}
function deleteMap(id) {
  const m = store.maps.find(x => x.id === id);
  if (!m || !confirm('Excluir o mapa "' + m.name + '"? Isso não pode ser desfeito.')) return;
  store.maps = store.maps.filter(x => x.id !== id);
  if (!store.maps.length) { const s = starter(); store.maps.push(s); }
  if (store.cur === id) openMap(store.maps[0].id); else save();
  renderList();
}
function renderList() {
  const ul = $('#list');
  ul.innerHTML = '';
  store.maps.forEach(m => {
    const li = document.createElement('li');
    if (m.id === store.cur) li.className = 'cur';
    const b = document.createElement('button');
    b.className = 'open';
    b.textContent = m.name;
    const s = document.createElement('small');
    s.textContent = m.nodes.length + (m.nodes.length === 1 ? ' caixa' : ' caixas');
    b.appendChild(s);
    b.addEventListener('click', () => { openMap(m.id); closePanel(); });
    const x = document.createElement('button');
    x.className = 'rm';
    x.textContent = '🗑';
    x.setAttribute('aria-label', 'Excluir ' + m.name);
    x.addEventListener('click', () => deleteMap(m.id));
    li.append(b, x);
    ul.appendChild(li);
  });
}
function openPanel() { endEdit(); renderList(); panel.hidden = false; }
function closePanel() { panel.hidden = true; }
$('#p-close').addEventListener('click', closePanel);
panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });

function slug(s) {
  return (s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()) || 'mapa';
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function outline() {
  const kids = id => map.edges.filter(e => e.from === id).map(e => N(e.to)).filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x);
  const hasIn = new Set(map.edges.map(e => e.to));
  const seen = new Set();
  const lines = ['# ' + map.name, ''];
  const walk = (n, d) => {
    const pad = '  '.repeat(d);
    const parts = (n.text.trim() || '(sem texto)').split('\n');
    const tag = n.c ? '[' + COLOR_NAMES[n.c] + '] ' : '';
    if (seen.has(n.id)) { lines.push(pad + '- ↺ ' + parts[0]); return; }
    seen.add(n.id);
    lines.push(pad + '- ' + tag + parts[0]);
    for (let i = 1; i < parts.length; i++) lines.push(pad + '  ' + parts[i]);
    kids(n.id).forEach(k => walk(k, d + 1));
  };
  map.nodes.filter(n => !hasIn.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x).forEach(n => walk(n, 0));
  map.nodes.filter(n => !seen.has(n.id)).forEach(n => walk(n, 0));
  return lines.join('\n') + '\n';
}

panel.addEventListener('click', e => {
  const b = e.target.closest ? e.target.closest('[data-p]') : null;
  if (!b) return;
  switch (b.dataset.p) {
    case 'new': newMap(); closePanel(); break;
    case 'json':
      download(slug(map.name) + '.writermap.json', JSON.stringify({ app: 'WriterMap', version: 1, ...map }, null, 2), 'application/json');
      break;
    case 'md': download(slug(map.name) + '.md', outline(), 'text/markdown'); break;
    case 'import': fileIn.value = ''; fileIn.click(); break;
    case 'install': doInstall(); break;
  }
});
fileIn.addEventListener('change', () => {
  const f = fileIn.files && fileIn.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const o = JSON.parse(rd.result);
      const list = Array.isArray(o.maps) ? o.maps : [o];
      if (!list.some(x => x && Array.isArray(x.nodes))) throw new Error('formato');
      let last = null;
      list.forEach(x => {
        if (!x || !Array.isArray(x.nodes)) return;
        const m = cleanMap(x);
        if (store.maps.some(y => y.id === m.id)) m.id = uid();
        store.maps.push(m);
        last = m;
      });
      openMap(last.id);
      closePanel();
      toast('Mapa importado.');
    } catch (_) { toast('Arquivo inválido. Use um .json exportado pelo WriterMap.'); }
  };
  rd.readAsText(f);
});

/* ============ Instalação PWA ============ */
let deferred = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#btn-install').hidden = false; });
window.addEventListener('appinstalled', () => { deferred = null; $('#btn-install').hidden = true; toast('WriterMap instalado!'); });
function doInstall() {
  if (!deferred) return;
  deferred.prompt();
  deferred = null;
  $('#btn-install').hidden = true;
}

/* ============ Aviso rápido ============ */
let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ============ Início ============ */
store = load();
openMap(store.cur);

document.addEventListener('visibilitychange', () => { if (document.hidden) { endEdit(); save(); } });
window.addEventListener('pagehide', () => { endEdit(); save(); });
window.addEventListener('resize', () => schedEdges());

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
})();
