// 阅读器：单页 / 双页版式、翻页动画、控制栏、全屏

import { findBook, getBookViewMode, setBookViewMode, getProgress, setProgress } from './store.js';
import { getPdfData, openPdf } from './import.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const bookEl = $('book');
const controls = $('controls');

const FLIP_MS = 650;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  book: null,
  doc: null,
  n: 0,
  aspects: [],      // 每页宽高比（下标从 1 开始）
  baseAspect: 0.75, // 用于“自动”版式判断的典型页面比例
  pref: 'auto',     // 'auto' | 'single' | 'double'
  mode: 'single',   // 实际使用的版式
  views: [],        // 每个画面包含的页码，双页时为 [左, 右]（可为 null）
  cur: 0,           // 当前画面下标
  busy: false,
  pending: null,
  renders: new Map(),
};

/* ---------- 状态提示 ---------- */
function setStatus(text, { error = false, progress = null } = {}) {
  const st = $('status');
  st.hidden = false;
  st.classList.toggle('error', error);
  $('statusText').textContent = text;
  const bar = st.querySelector('.progress');
  bar.hidden = progress == null;
  if (progress != null) $('progressBar').style.width = Math.round(progress * 100) + '%';
}
function showError(msg) {
  setStatus(msg, { error: true });
  const links = document.createElement('div');
  links.className = 'status-links';
  links.innerHTML = '<a class="btn" href="index.html">返回书架</a> <a class="btn primary" href="setup.html">打开设置</a>';
  $('status').appendChild(links);
}

/* ---------- 版式 ---------- */
function aspect(p) {
  return (p && S.aspects[p]) || S.baseAspect;
}

function stageBox() {
  const r = stage.getBoundingClientRect();
  const pad = Math.min(16, Math.max(4, Math.min(r.width, r.height) * 0.02));
  return { W: Math.max(50, r.width - pad * 2), H: Math.max(50, r.height - pad * 2) };
}

// 根据屏幕与页面比例决定单页/双页：双页能明显放大显示面积时才用双页
function autoMode() {
  const { W, H } = stageBox();
  const a = S.baseAspect;
  const fit = (ar) => (W / H > ar ? H * H * ar : (W * W) / ar);
  return fit(2 * a) > fit(a) * 1.35 ? 'double' : 'single';
}

function buildViews() {
  const v = [];
  if (S.mode === 'double') {
    // 封面单独放在右侧，之后两页一组
    v.push([null, 1]);
    for (let p = 2; p <= S.n; p += 2) v.push([p, p + 1 <= S.n ? p + 1 : null]);
  } else {
    for (let p = 1; p <= S.n; p++) v.push([p]);
  }
  S.views = v;
}

function viewOfPage(p) {
  const i = S.views.findIndex((v) => v.includes(p));
  return i < 0 ? 0 : i;
}
function firstPage(view) {
  return view.find((p) => p) || 1;
}

function layoutFor(view) {
  const { W, H } = stageBox();
  if (view.length === 1) {
    const a = aspect(view[0]);
    const h = Math.min(H, W / a);
    return { h, widths: [h * a] };
  }
  const [l, r] = view;
  const al = aspect(l || r);
  const ar = aspect(r || l);
  const h = Math.min(H, W / (al + ar));
  return { h, widths: [h * al, h * ar] };
}

/* ---------- 渲染 ---------- */
async function loadAspects(pages) {
  await Promise.all(
    pages.filter((p) => p && !S.aspects[p]).map(async (p) => {
      const page = await S.doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      S.aspects[p] = vp.width / vp.height;
    })
  );
}

const MAX_PIXELS = 16e6;

function renderPage(p, w, h) {
  const key = `${p}@${Math.round(w)}x${Math.round(h)}`;
  if (S.renders.has(key)) {
    const v = S.renders.get(key);
    S.renders.delete(key);
    S.renders.set(key, v); // LRU
    return v;
  }
  const job = (async () => {
    const page = await S.doc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const css = Math.min(w / vp1.width, h / vp1.height);
    let dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const px = vp1.width * vp1.height * (css * dpr) ** 2;
    if (px > MAX_PIXELS) dpr *= Math.sqrt(MAX_PIXELS / px);
    const vp = page.getViewport({ scale: css * dpr });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width));
    c.height = Math.max(1, Math.floor(vp.height));
    c.dataset.cssW = (vp1.width * css).toFixed(2);
    c.dataset.cssH = (vp1.height * css).toFixed(2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  })();
  job.catch(() => S.renders.delete(key));
  S.renders.set(key, job);
  while (S.renders.size > 14) S.renders.delete(S.renders.keys().next().value);
  return job;
}

function copyCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  c.style.width = src.dataset.cssW + 'px';
  c.style.height = src.dataset.cssH + 'px';
  c.className = 'page';
  return c;
}

// 把页面放进容器；align: 'start'（靠左）| 'end'（靠右）| 'center'
function fill(el, canvasMap, p, align) {
  el.innerHTML = '';
  el.dataset.align = align;
  if (p && canvasMap.has(p)) el.appendChild(copyCanvas(canvasMap.get(p)));
}

function makeSlot(x, w, h) {
  const d = document.createElement('div');
  d.className = 'slot';
  Object.assign(d.style, { left: x + 'px', width: w + 'px', height: h + 'px' });
  return d;
}

/* ---------- 显示 / 翻页 ---------- */
function updateInfo() {
  const v = S.views[S.cur] || [];
  const ps = v.filter(Boolean);
  $('pageInfo').textContent = ps.length ? `${ps.join('-')} / ${S.n}` : `– / ${S.n}`;
  $('firstBtn').disabled = $('prevBtn').disabled = S.cur <= 0;
  $('lastBtn').disabled = $('nextBtn').disabled = S.cur >= S.views.length - 1;
  $('modeText').textContent = S.mode === 'double' ? '双页' : '单页';
  document.body.dataset.mode = S.mode;
  setProgress(S.book.key, firstPage(v));
}

async function go(target, animate = true) {
  target = Math.max(0, Math.min(S.views.length - 1, target));
  if (S.busy) {
    S.pending = target;
    return;
  }
  if (target === S.cur && bookEl.dataset.ready) return;
  S.busy = true;
  try {
    await draw(target, animate && !reduceMotion && bookEl.dataset.ready && target !== S.cur);
  } catch (e) {
    console.error(e);
  }
  S.busy = false;
  if (S.pending != null) {
    const p = S.pending;
    S.pending = null;
    go(p);
  } else {
    preload();
  }
}

async function draw(target, animate) {
  const from = S.views[S.cur];
  const to = S.views[target];
  const dir = target > S.cur ? 1 : -1;
  await loadAspects([...to, ...(animate ? from : [])]);
  const L = layoutFor(to);
  const dbl = to.length === 2;

  // 需要的页面：按目标版式的格子大小渲染
  const need = new Map(); // page -> [w, h]
  const want = (p, i) => p && need.set(p, [L.widths[Math.min(i, L.widths.length - 1)], L.h]);
  to.forEach((p, i) => want(p, i));
  if (animate) from.forEach((p, i) => want(p, dbl ? i : 0));
  const canvases = new Map();
  await Promise.all([...need].map(async ([p, [w, h]]) => canvases.set(p, await renderPage(p, w, h))));

  const totalW = L.widths.reduce((a, b) => a + b, 0);
  bookEl.hidden = false;
  bookEl.style.width = totalW + 'px';
  bookEl.style.height = L.h + 'px';
  bookEl.classList.toggle('double', dbl);
  bookEl.style.setProperty('--spine', (dbl ? L.widths[0] : 0) + 'px');
  bookEl.innerHTML = '';

  const slots = dbl
    ? [makeSlot(0, L.widths[0], L.h), makeSlot(L.widths[0], L.widths[1], L.h)]
    : [makeSlot(0, L.widths[0], L.h)];
  slots.forEach((s) => bookEl.appendChild(s));
  const alignOf = (i) => (dbl ? (i === 0 ? 'end' : 'start') : 'center');

  const finalize = () => {
    bookEl.querySelectorAll('.flipper').forEach((f) => f.remove());
    to.forEach((p, i) => fill(slots[i], canvases, p, alignOf(i)));
    S.cur = target;
    bookEl.dataset.ready = '1';
    updateInfo();
  };

  if (!animate) return finalize();

  // 翻页动画：静止层显示“翻页后会露出”的内容，翻转层正面是旧页、背面是新页
  const flipper = document.createElement('div');
  flipper.className = 'flipper';
  const front = document.createElement('div');
  const back = document.createElement('div');
  front.className = 'face front';
  back.className = 'face back';
  flipper.append(front, back);
  let fromDeg, toDeg;

  if (dbl) {
    if (dir > 0) {
      fill(slots[0], canvases, from[0], 'end');
      fill(slots[1], canvases, to[1], 'start');
      Object.assign(flipper.style, { left: L.widths[0] + 'px', width: L.widths[1] + 'px', transformOrigin: 'left center' });
      fill(front, canvases, from[1], 'start');
      fill(back, canvases, to[0], 'end');
      fromDeg = 0; toDeg = -180;
    } else {
      fill(slots[0], canvases, to[0], 'end');
      fill(slots[1], canvases, from[1], 'start');
      Object.assign(flipper.style, { left: '0px', width: L.widths[0] + 'px', transformOrigin: 'right center' });
      fill(front, canvases, from[0], 'end');
      fill(back, canvases, to[1], 'start');
      fromDeg = 0; toDeg = 180;
    }
  } else {
    Object.assign(flipper.style, { left: '0px', width: L.widths[0] + 'px', transformOrigin: 'left center' });
    if (dir > 0) {
      fill(slots[0], canvases, to[0], 'center');
      fill(front, canvases, from[0], 'center');
      fromDeg = 0; toDeg = -180;
    } else {
      fill(slots[0], canvases, from[0], 'center');
      fill(front, canvases, to[0], 'center');
      fromDeg = -180; toDeg = 0;
    }
  }
  flipper.style.height = L.h + 'px';
  flipper.style.transform = `rotateY(${fromDeg}deg)`;
  flipper.classList.add(dir > 0 ? 'fwd' : 'bwd');
  bookEl.appendChild(flipper);
  flipper.getBoundingClientRect(); // 触发重排，让过渡生效

  await new Promise((resolve) => {
    let done = false;
    const end = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    flipper.addEventListener('transitionend', end, { once: true });
    setTimeout(end, FLIP_MS + 150);
    flipper.style.transition = `transform ${FLIP_MS}ms cubic-bezier(.45,.05,.35,1)`;
    flipper.style.transform = `rotateY(${toDeg}deg)`;
    flipper.classList.add('turning');
  });
  finalize();
}

// 预先渲染前后画面，翻页更流畅
function preload() {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 120));
  idle(async () => {
    for (const i of [S.cur + 1, S.cur - 1]) {
      const v = S.views[i];
      if (!v) continue;
      try {
        await loadAspects(v);
        const L = layoutFor(v);
        v.forEach((p, k) => p && renderPage(p, L.widths[Math.min(k, L.widths.length - 1)], L.h));
      } catch {}
    }
  });
}

const next = () => go(S.cur + 1);
const prev = () => go(S.cur - 1);
const first = () => go(0);
const last = () => go(S.views.length - 1);

function applyMode(keepPage) {
  if (S.busy) return setTimeout(() => applyMode(keepPage), 200);
  S.mode = S.pref === 'auto' ? autoMode() : S.pref;
  buildViews();
  S.cur = viewOfPage(keepPage);
  delete bookEl.dataset.ready;
  S.renders.clear();
  go(S.cur, false);
}

function toggleMode() {
  if (S.busy || !S.views.length) return;
  const page = firstPage(S.views[S.cur]);
  S.pref = S.mode === 'double' ? 'single' : 'double';
  setBookViewMode(S.book.key, S.pref);
  applyMode(page);
}

/* ---------- 全屏 ---------- */
const root = document.documentElement;
const nativeFs = !!(root.requestFullscreen || root.webkitRequestFullscreen);
let pseudoFs = false;

function isFs() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement) || pseudoFs;
}
function enterFs() {
  if (nativeFs) {
    const r = (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    if (r && r.catch) r.catch(() => setPseudo(true));
  } else {
    setPseudo(true);
  }
}
function exitFs() {
  if (pseudoFs) return setPseudo(false);
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  if (ex) {
    const r = ex.call(document);
    if (r && r.catch) r.catch(() => {});
  }
}
function setPseudo(on) {
  pseudoFs = on;
  onFsChange();
}
function onFsChange() {
  const fs = isFs();
  document.body.classList.toggle('is-fs', fs);
  $('fsBtn').title = fs ? '退出全屏' : '全屏';
  $('fsBtn').setAttribute('aria-label', $('fsBtn').title);
  hideControls();
  scheduleRelayout();
}
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

/* 全屏时的控制栏：点击页面中间显示，几秒后自动隐藏 */
let hideTimer = null;
function showControls() {
  document.body.classList.add('show-controls');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideControls, 4000);
}
function hideControls() {
  clearTimeout(hideTimer);
  document.body.classList.remove('show-controls');
}
function toggleControls() {
  if (document.body.classList.contains('show-controls')) hideControls();
  else showControls();
}
controls.addEventListener('pointerdown', () => isFs() && showControls());

/* ---------- 交互 ---------- */
$('fsBtn').onclick = () => (isFs() ? exitFs() : enterFs());
$('firstBtn').onclick = first;
$('prevBtn').onclick = prev;
$('nextBtn').onclick = next;
$('lastBtn').onclick = last;
$('modeBtn').onclick = toggleMode;
$('exitBtn').onclick = () => {
  if (isFs()) exitFs();
  location.href = 'index.html';
};

// 点击左 1/3 上一页，右 1/3 下一页，中间（全屏时）显示/隐藏控制栏；也支持左右滑动
let down = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  down = { x: e.clientX, y: e.clientY, t: Date.now() };
});
stage.addEventListener('pointerup', (e) => {
  if (!down || !S.views.length) return;
  if (e.target.closest('a, button')) return (down = null);
  const dx = e.clientX - down.x;
  const dy = e.clientY - down.y;
  down = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) return dx < 0 ? next() : prev();
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
  const r = stage.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  if (x < 1 / 3) prev();
  else if (x > 2 / 3) next();
  else if (isFs()) toggleControls();
});
stage.addEventListener('pointercancel', () => (down = null));
stage.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  switch (e.key) {
    case 'ArrowRight': case 'PageDown': case ' ': case 'ArrowDown': next(); break;
    case 'ArrowLeft': case 'PageUp': case 'ArrowUp': prev(); break;
    case 'Home': first(); break;
    case 'End': last(); break;
    case 'f': case 'F': isFs() ? exitFs() : enterFs(); break;
    case 'Escape': if (isFs()) exitFs(); return; // 多数浏览器会自行处理 Esc，这里作为兜底
    default: return;
  }
  e.preventDefault();
});

let relayoutTimer = null;
function scheduleRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    if (!S.doc) return;
    applyMode(firstPage(S.views[S.cur] || [1]));
  }, 160);
}
window.addEventListener('resize', scheduleRelayout);

/* ---------- 启动 ---------- */
(async () => {
  const key = new URLSearchParams(location.search).get('book');
  const book = key && (await findBook(key));
  if (!book) return showError('找不到这本书，可能已被删除。');
  S.book = book;
  document.title = `${book.name || '阅读'} · 故事盒子`;
  S.pref = getBookViewMode(book.key);

  try {
    setStatus('正在下载绘本…', { progress: 0 });
    const data = await getPdfData(book, (got, total) => {
      const mb = (got / 1048576).toFixed(1);
      setStatus(total ? `正在下载绘本… ${mb} / ${(total / 1048576).toFixed(1)} MB` : `正在下载绘本… ${mb} MB`, {
        progress: total ? got / total : null,
      });
    });
    setStatus('正在打开…');
    S.doc = await openPdf(data);
    S.n = S.doc.numPages;
    // 用前几页的中位数作为典型比例（封面比例有时与内页不同）
    const sample = [];
    for (let p = 1; p <= Math.min(S.n, 5); p++) sample.push(p);
    await loadAspects(sample);
    const sorted = sample.map((p) => S.aspects[p]).sort((a, b) => a - b);
    S.baseAspect = sorted[Math.floor(sorted.length / 2)] || 0.75;
    $('status').hidden = true;
    applyMode(Math.min(getProgress(book.key), S.n));
  } catch (e) {
    console.error(e);
    showError(e.message || '打开失败');
  }
})();
