// 阅读器：单页 / 双页版式、翻页动画、控制栏、全屏

import { findBook, getBookViewMode, setBookViewMode, getProgress, setProgress } from './store.js';
import { getPdfData, openPdf } from './import.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const bookEl = $('book');
const controls = $('controls');

const FLIP_MS = 800;
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
  S.goingTo = target;
  try {
    if (animate && !reduceMotion && bookEl.dataset.ready && target !== S.cur) {
      const turn = await prepareTurn(target);
      await animateTurn(turn, 0, 1, FLIP_MS);
      turn.commit();
    } else {
      await drawStatic(target);
    }
  } catch (e) {
    console.error(e);
  }
  endBusy();
}

function endBusy() {
  S.busy = false;
  if (S.pending != null) {
    const p = S.pending;
    S.pending = null;
    go(p);
  } else {
    preload();
  }
}

// 渲染某个画面需要的页面（以及翻页时需要的旧页面），按目标画面的格子大小
async function canvasesFor(to, from) {
  await loadAspects([...to, ...(from || [])]);
  const L = layoutFor(to);
  const dbl = to.length === 2;
  const need = new Map(); // page -> [w, h]
  const want = (p, i) => p && need.set(p, [L.widths[Math.min(i, L.widths.length - 1)], L.h]);
  to.forEach((p, i) => want(p, i));
  if (from) from.forEach((p, i) => want(p, dbl ? i : 0));
  const canvases = new Map();
  await Promise.all([...need].map(async ([p, [w, h]]) => canvases.set(p, await renderPage(p, w, h))));
  return { L, dbl, canvases };
}

function setupBook(L, dbl) {
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
  return slots;
}

const alignOf = (dbl, i) => (dbl ? (i === 0 ? 'end' : 'start') : 'center');

async function drawStatic(target) {
  const to = S.views[target];
  const { L, dbl, canvases } = await canvasesFor(to);
  const slots = setupBook(L, dbl);
  to.forEach((p, i) => fill(slots[i], canvases, p, alignOf(dbl, i)));
  S.cur = target;
  bookEl.dataset.ready = '1';
  updateInfo();
}

/* ---------- 弯曲翻页 ----------
   翻动的那一页被切成若干竖条，每一条都嵌套在前一条里面，并相对前一条再转一个小角度，
   连起来就形成一条柔和的弧线。正面是旧页的切片，背面是新页的切片。 */
const STRIPS = 14;
const CURL = 85; // 翻到一半时，外缘比书脊一侧多转的角度

// 把页面画布按格子对齐后，取出 [x0, x0+sw] 这一竖条画到新的小画布上
function sliceCanvas(src, align, slotW, slotH, x0, sw, mirror = false) {
  const pw = parseFloat(src.dataset.cssW);
  const ph = parseFloat(src.dataset.cssH);
  const k = src.width / pw; // 每个 CSS 像素对应的画布像素
  const ox = align === 'start' ? 0 : align === 'end' ? slotW - pw : (slotW - pw) / 2;
  const oy = (slotH - ph) / 2;
  const c = document.createElement('canvas');
  const cw = sw + 1; // 多 1px，避免竖条之间露缝
  c.width = Math.max(1, Math.ceil(cw * k));
  c.height = Math.max(1, Math.ceil(slotH * k));
  c.style.width = cw + 'px';
  c.style.height = slotH + 'px';
  const ctx = c.getContext('2d');
  if (mirror) {
    // 单页模式下页面背面：显示正面的镜像（像透过纸张看到的样子）
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, (ox - x0) * k, oy * k, pw * k, ph * k);
  return c;
}

// side: 'right' 表示书脊在左、页面向右展开（向后翻时从右往左掀）；'left' 相反
function buildCurl({ side, x, w, h, front, back, paperBack }) {
  const root = document.createElement('div');
  root.className = 'curl';
  Object.assign(root.style, { left: x + 'px', width: w + 'px', height: h + 'px' });
  const sw = w / STRIPS;
  const strips = [];
  let parent = root;
  for (let k = 0; k < STRIPS; k++) {
    const s = document.createElement('div');
    s.className = 'strip';
    const posLeft = side === 'right' ? (k === 0 ? 0 : sw) : k === 0 ? w - sw : -sw;
    Object.assign(s.style, {
      left: posLeft + 'px', width: sw + 'px', height: h + 'px',
      transformOrigin: side === 'right' ? 'left center' : 'right center',
    });
    const f = document.createElement('div');
    f.className = 'sface';
    const b = document.createElement('div');
    b.className = 'sface sback';
    const fx = side === 'right' ? k * sw : w - (k + 1) * sw;
    const bx = side === 'right' ? w - (k + 1) * sw : k * sw;
    if (front && front.canvas) f.appendChild(sliceCanvas(front.canvas, front.align, w, h, fx, sw));
    if (back && back.canvas) b.appendChild(sliceCanvas(back.canvas, back.align, w, h, bx, sw));
    else if (paperBack) {
      b.classList.add('paper');
      if (front && front.canvas) b.appendChild(sliceCanvas(front.canvas, front.align, w, h, fx, sw, true));
    }
    const fs = document.createElement('i');
    const bs = document.createElement('i');
    f.appendChild(fs);
    b.appendChild(bs);
    s.append(f, b);
    parent.appendChild(s);
    strips.push({ el: s, fshade: fs, bshade: bs });
    parent = s;
  }
  const sign = side === 'right' ? -1 : 1;
  // 光影方向：从书脊一侧指向外缘
  const fDir = side === 'right' ? 90 : 270;
  const bDir = side === 'right' ? 270 : 90;
  const shadeF = (a) => Math.max(0, 1 - Math.cos((a * Math.PI) / 180)) * 0.42;
  const shadeB = (a) => Math.max(0, 1 + Math.cos((a * Math.PI) / 180)) * 0.42;
  const grad = (dir, s0, s1) => `linear-gradient(${dir}deg, rgba(26,18,12,${s0.toFixed(3)}), rgba(26,18,12,${s1.toFixed(3)}))`;
  return {
    el: root,
    // t: 0 = 平放在原位，1 = 完全翻到另一边
    set(t) {
      const curl = CURL * Math.sin(Math.PI * t);
      let prevA = 0;
      let prevMid = 0;
      for (let k = 0; k < STRIPS; k++) {
        const f = Math.pow(k / (STRIPS - 1), 1.6);
        const a = Math.min(180, 180 * t + curl * f); // 这一条的累计角度
        const st = strips[k];
        st.el.style.transform = `rotateY(${sign * (a - prevA)}deg)`;
        const start = k === 0 ? a : prevMid;
        const nextA = Math.min(180, 180 * t + curl * Math.pow(Math.min(1, (k + 1) / (STRIPS - 1)), 1.6));
        const end = (a + nextA) / 2;
        // 越接近侧立越暗，用渐变让相邻竖条之间过渡平滑
        st.fshade.style.background = grad(fDir, shadeF(start), shadeF(end));
        st.bshade.style.background = grad(bDir, shadeB(start), shadeB(end));
        prevA = a;
        prevMid = end;
      }
    },
  };
}

// 准备一次翻页：摆好静止层和弯曲层，返回可以逐帧设置进度的对象
async function prepareTurn(target) {
  const from = S.views[S.cur];
  const to = S.views[target];
  const dir = target > S.cur ? 1 : -1;
  const { L, dbl, canvases } = await canvasesFor(to, from);
  const slots = setupBook(L, dbl);
  const src = (p, align) => ({ canvas: p ? canvases.get(p) : null, align });
  let curl;
  let reverse = false;

  if (dbl) {
    if (dir > 0) {
      fill(slots[0], canvases, from[0], 'end');
      fill(slots[1], canvases, to[1], 'start');
      curl = buildCurl({ side: 'right', x: L.widths[0], w: L.widths[1], h: L.h, front: src(from[1], 'start'), back: src(to[0], 'end') });
    } else {
      fill(slots[0], canvases, to[0], 'end');
      fill(slots[1], canvases, from[1], 'start');
      curl = buildCurl({ side: 'left', x: 0, w: L.widths[0], h: L.h, front: src(from[0], 'end'), back: src(to[1], 'start') });
    }
  } else if (dir > 0) {
    fill(slots[0], canvases, to[0], 'center');
    curl = buildCurl({ side: 'right', x: 0, w: L.widths[0], h: L.h, front: src(from[0], 'center'), paperBack: true });
  } else {
    // 单页向前翻：新页从左边翻回来盖住旧页
    fill(slots[0], canvases, from[0], 'center');
    curl = buildCurl({ side: 'right', x: 0, w: L.widths[0], h: L.h, front: src(to[0], 'center'), paperBack: true });
    reverse = true;
  }
  bookEl.appendChild(curl.el);

  const turn = {
    dir,
    single: !dbl,
    width: dbl ? (dir > 0 ? L.widths[1] : L.widths[0]) : L.widths[0],
    p: 0,
    setP(p) {
      turn.p = p;
      const t = reverse ? 1 - p : p;
      curl.set(t);
      // 单页模式下，翻过去的纸逐渐淡出
      if (!dbl) curl.el.style.opacity = t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4).toFixed(3) : '1';
    },
    commit() {
      curl.el.remove();
      to.forEach((p, i) => fill(slots[i], canvases, p, alignOf(dbl, i)));
      S.cur = target;
      bookEl.dataset.ready = '1';
      updateInfo();
    },
    revert() {
      return drawStatic(S.cur);
    },
  };
  turn.setP(0);
  return turn;
}

const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function animateTurn(turn, p0, p1, ms) {
  return new Promise((resolve) => {
    if (ms <= 0 || reduceMotion) {
      turn.setP(p1);
      return resolve();
    }
    const start = performance.now();
    const stepFn = (now) => {
      const x = Math.min(1, (now - start) / ms);
      turn.setP(p0 + (p1 - p0) * easeInOut(x));
      if (x < 1) requestAnimationFrame(stepFn);
      else resolve();
    };
    requestAnimationFrame(stepFn);
  });
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

// 连续快速点击时，以排队中的目标为基准继续翻
const base = () => (!S.busy ? S.cur : S.pending != null ? S.pending : S.goingTo ?? S.cur);
const next = () => go(base() + 1);
const prev = () => go(base() - 1);
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

// 点击左 1/3 上一页，右 1/3 下一页，中间（全屏时）显示/隐藏控制栏；
// 按住页面左右拖动可以像真书一样慢慢翻页，松手后自动翻完或弹回
let down = null;
let drag = null;
const activePointers = new Set();

stage.addEventListener('pointerdown', (e) => {
  activePointers.add(e.pointerId);
  if (activePointers.size > 1) {
    // 多指操作（缩放）时不翻页
    down = null;
    return;
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (e.target.closest('a, button')) return;
  down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
});

stage.addEventListener('pointermove', (e) => {
  if (!down || e.pointerId !== down.id) return;
  const dx = e.clientX - down.x;
  const dy = e.clientY - down.y;
  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) down.moved = true;
  if (drag) return updateDrag(e);
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2 && !S.busy && S.views.length && bookEl.dataset.ready) {
    const dir = dx < 0 ? 1 : -1;
    const target = S.cur + dir;
    if (target < 0 || target >= S.views.length) return;
    startDrag(dir, target, e);
  }
});

function startDrag(dir, target, e) {
  S.busy = true;
  S.goingTo = null;
  try {
    stage.setPointerCapture(e.pointerId);
  } catch {}
  const d = { dir, p: 0, startX: down.x, samples: [], turn: null, failed: false };
  drag = d;
  d.ready = prepareTurn(target)
    .then((turn) => {
      d.turn = turn;
      turn.setP(d.p);
    })
    .catch((err) => {
      console.error(err);
      d.failed = true;
    });
  updateDrag(e);
}

function updateDrag(e) {
  const d = drag;
  const w = d.turn ? d.turn.width : stage.clientWidth / 2;
  const travel = w * (d.turn && d.turn.single ? 1.1 : 1.7);
  const moved = (d.startX - e.clientX) * d.dir; // 朝翻页方向移动的距离
  d.p = Math.max(0, Math.min(1, moved / travel));
  const now = performance.now();
  d.samples.push({ x: e.clientX, t: now });
  while (d.samples.length > 2 && now - d.samples[0].t > 120) d.samples.shift();
  if (d.turn) d.turn.setP(d.p);
}

async function finishDrag(cancelled) {
  const d = drag;
  drag = null;
  await d.ready;
  if (d.failed || !d.turn) {
    await drawStatic(S.cur).catch(() => {});
    return endBusy();
  }
  // 松手时的速度（像素/毫秒，正值表示朝翻页方向）
  let v = 0;
  const now = performance.now();
  d.samples = d.samples.filter((s) => now - s.t < 120);
  if (d.samples.length >= 2) {
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    if (b.t > a.t) v = ((a.x - b.x) * d.dir) / (b.t - a.t);
  }
  let complete = !cancelled && (d.p > 0.4 || (v > 0.3 && d.p > 0.03));
  if (v < -0.3) complete = false;
  const end = complete ? 1 : 0;
  const ms = Math.max(160, FLIP_MS * Math.abs(end - d.p));
  await animateTurn(d.turn, d.p, end, ms);
  if (complete) d.turn.commit();
  else await d.turn.revert();
  endBusy();
}

stage.addEventListener('pointerup', (e) => {
  activePointers.delete(e.pointerId);
  if (!down || e.pointerId !== down.id) return;
  const wasMoved = down.moved;
  down = null;
  if (drag) return finishDrag(false);
  if (wasMoved || !S.views.length) return;
  const r = stage.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  if (x < 1 / 3) prev();
  else if (x > 2 / 3) next();
  else if (isFs()) toggleControls();
});
stage.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (down && e.pointerId === down.id) {
    down = null;
    if (drag) finishDrag(true);
  }
});
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
