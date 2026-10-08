/* ============================================================================
   VOLT — THE PRECISION PASS
   A scripted clipper moves through the page. Its blade edge is the reveal.
   ========================================================================== */
(() => {
'use strict';

/* ─────────────────────────────  helpers  ───────────────────────────── */
const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const eOutQuint = t => 1 - Math.pow(1 - t, 5);
const eInOutQuint = t => (t < .5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2);
const eInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eOutExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t));
const normAng = a => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
const lerpAng = (a, b, t) => a + normAng(b - a) * t;

const TILT = 0.016;        // blade rake, as a fraction of the span it crosses
const TIP  = 0.482;        // element-centre → blade tip, as a fraction of clipper width

/* ─────────────────────────────  dom  ───────────────────────────── */
const clipperEl = $('#clipper');
const edgeEl    = $('#edge');
const introEl   = $('#intro');
const countEl   = $('#introCount');
const progBar   = $('#progBar');
const progNum   = $('#progNum');
const navEl     = $('#nav');
const rails     = $$('.rail');
const marquee   = $('#marqueeTrack');
const cv        = $('#sparks');
const ctx       = cv.getContext('2d');

let vw = innerWidth, vh = innerHeight, docH = 0, scrollY = 0;
let clipW = 260;

/* ─────────────────────────────  pass registry  ───────────────────────────── */
const passes = [];

function buildPasses() {
  passes.length = 0;
  $$('.pass').forEach(el => {
    const dir = el.dataset.pass;
    if (!dir) return;
    const box = el.classList.contains('pass__box') ? el : el.querySelector('.pass__box');
    const target = box || el;
    const cls = 'cut--' + dir;
    target.classList.add('cut', cls);

    const kids = $$('.pc', el).map(k => {
      k.classList.add('cut', cls);
      return { el: k, doc: null };
    });

    passes.push({
      el, target, dir, kids,
      intro: el.hasAttribute('data-intro'),
      ct: 0, cr: 0, doc: null, start: 0, end: 0, len: 1
    });
  });
}

function measure() {
  vw = innerWidth; vh = innerHeight;
  docH = document.documentElement.scrollHeight;

  clipW = Math.round(clamp(vw * 0.185, 112, 300));
  clipperEl.style.setProperty('--cw', clipW + 'px');

  const sy = scrollY;
  const live = passes.filter(p => !p.intro);

  live.forEach(p => {
    const r = p.el.getBoundingClientRect();
    p.doc = { t: r.top + sy, l: r.left, w: r.width, h: r.height };
    const sv  = parseFloat(p.dataset.start || '0.9');
    const lf  = parseFloat(p.dataset.len || '0');
    const horiz = p.dir === 'ltr' || p.dir === 'rtl';
    p.len = (lf || (horiz ? 0.5 + 0.3 * (r.width / Math.max(vw, 1)) : 0.56)) * vh;
    p.len = clamp(p.len, vh * 0.34, vh * 1.15);
    p.start = r.top + sy - vh * sv;
    p.end   = p.start + p.len;
  });

  // enforce a strictly sequential choreography — one blade, one stroke at a time
  let prevEnd = -Infinity;
  live.forEach(p => {
    if (p.start < prevEnd + 24) p.start = prevEnd + 24;
    p.end = p.start + p.len;
    prevEnd = p.end;
  });

  // intro nodes: document geometry only (driven by the timeline, not scroll)
  passes.filter(p => p.intro).forEach(p => {
    const r = p.el.getBoundingClientRect();
    p.doc = { t: r.top + sy, l: r.left, w: r.width, h: r.height };
    p.ct = p.cr = 1;
  });

  live.forEach(p => {
    p.kids.forEach(k => {
      const r = k.el.getBoundingClientRect();
      k.doc = { t: r.top + sy, l: r.left, w: r.width, h: r.height };
    });
    p.cr = clamp((scrollY - p.start) / p.len);
    p.ct = p.cr;
    applyC(p);
  });
}

function applyC(p) {
  p.target.style.setProperty('--c', p.cr.toFixed(4));
  const horiz = p.dir === 'ltr' || p.dir === 'rtl';
  const span  = horiz ? p.doc.w : p.doc.h;
  const T     = TILT * span;
  const lead  = p.doc.t + p.cr * (span + 2 * T) - T;          // doc-coordinate edge
  const tail  = p.doc.t + p.doc.h;

  p.kids.forEach(k => {
    if (!k.doc) return;
    let c;
    if (p.dir === 'ltr')      c = (lead - k.doc.l) / (k.doc.w * (1 + 2 * TILT));
    else if (p.dir === 'rtl') c = ((k.doc.l + k.doc.w) - lead) / (k.doc.w * (1 + 2 * TILT));
    else if (p.dir === 'ttb') c = (lead - k.doc.t) / (k.doc.h * (1 + 2 * TILT));
    else                      c = ((k.doc.t + k.doc.h) - lead) / (k.doc.h * (1 + 2 * TILT));
    k.el.style.setProperty('--c', clamp(c).toFixed(4));
  });
  void tail;
}

/* ─────────────────────────────  blade geometry  ───────────────────────────── */
function anchor(p, c, sY = scrollY) {
  const d = p.doc, dir = p.dir;
  let ex, ey, rot;
  if (dir === 'ltr' || dir === 'rtl') {
    const T = TILT * d.w;
    const s = Math.atan2(2 * T, d.h) * 180 / Math.PI;
    if (dir === 'ltr') { ex = d.l + c * (d.w + 2 * T) - T; rot = s; }
    else               { ex = d.l + d.w - c * (d.w + 2 * T) + T; rot = 180 - s; }
    ey = d.t - sY + d.h / 2;
  } else {
    const T = TILT * d.h;
    const s = Math.atan2(2 * T, d.w) * 180 / Math.PI;
    ex = d.l + d.w / 2;
    if (dir === 'ttb') { ey = d.t - sY + c * (d.h + 2 * T) - T; rot = 90 + s; }
    else               { ey = d.t - sY + d.h - c * (d.h + 2 * T) + T; rot = -90 - s; }
  }
  const r = rot * Math.PI / 180, half = TIP * clipW;
  return { x: ex - half * Math.cos(r), y: ey - half * Math.sin(r), rot, ex, ey };
}

function edgeGeom(p, c) {
  const d = p.doc, dir = p.dir, horiz = dir === 'ltr' || dir === 'rtl';
  const T = TILT * (horiz ? d.w : d.h);
  let ex, ey, rot;
  if (dir === 'ltr')      { ex = d.l + c * (d.w + 2 * T) - T; ey = d.t + d.h / 2; rot = Math.atan2(2 * T, d.h) * 180 / Math.PI; }
  else if (dir === 'rtl') { ex = d.l + d.w - c * (d.w + 2 * T) + T; ey = d.t + d.h / 2; rot = -Math.atan2(2 * T, d.h) * 180 / Math.PI; }
  else if (dir === 'ttb') { ex = d.l + d.w / 2; ey = d.t + c * (d.h + 2 * T) - T; rot = Math.atan2(2 * T, d.w) * 180 / Math.PI; }
  else                    { ex = d.l + d.w / 2; ey = d.t + d.h - c * (d.h + 2 * T) + T; rot = -Math.atan2(2 * T, d.w) * 180 / Math.PI; }
  return { ex, ey: ey - scrollY, rot, horiz };
}

const dock = () => ({
  x: vw - clipW * 0.62,
  y: vh - clipW * 0.42 + Math.sin(perfNow() * 0.0013) * 5,
  rot: -16
});

function flyTarget(p) { return anchor(p, 0); }

function clampToScreen(pt) {
  const mx = Math.min(120, vw * 0.14), my = Math.min(110, vh * 0.13);
  return {
    x: clamp(pt.x, -clipW * 0.4, vw - mx),
    y: clamp(pt.y, -clipW * 0.3, vh - my),
    rot: pt.rot
  };
}

const perfNow = () => performance.now();

/* ─────────────────────────────  intro timeline  ───────────────────────────── */
const nodeBy = {};
function indexNodes() {
  passes.forEach(p => { nodeBy[p.el.id] = p; });
}

const UI = [
  { t: 640,  fn: () => $('.hero__eyebrow')?.classList.add('is-in') },
  { t: 1900, fn: () => $('.hero__meta')?.parentElement?.classList.add('is-in') },
  { t: 1900, fn: () => $('.hero__meta')?.classList.add('is-in') },
  { t: 4180, fn: () => { navEl.classList.add('is-in'); rails.forEach(r => r.classList.add('is-in')); } },
  { t: 4260, fn: () => $('.hero__foot')?.classList.add('is-in') }
];

const TIMELINE = [
  { k: 'fly', a: 470,  b: 760,  to: { id: 'heroWord', c: 0 } },
  { k: 'cut', a: 760,  b: 1800, id: 'heroWord',  ease: eInOutQuint },
  { k: 'fly', a: 1800, b: 2130, to: { id: 'heroSub', c: 0 } },
  { k: 'cut', a: 2130, b: 2930, id: 'heroSub',   ease: eInOutQuint },
  { k: 'fly', a: 2930, b: 3230, to: { id: 'heroPlate', c: 0 } },
  { k: 'cut', a: 3230, b: 4120, id: 'heroPlate', ease: eInOutQuint },
  { k: 'fly', a: 4120, b: 4620, to: { dock: true } }
];
const INTRO_END = 4780;

let introT0 = 0, introDone = false, uiDone = 0;
let clip = { x: -500, y: 0, rot: 0 };

function resolveIntro(t) {
  const st = { x: -500, y: vh * 0.5, rot: 0 };
  let from = null;
  for (const s of TIMELINE) {
    if (t <= s.a) break;
    if (s.k === 'cut') {
      const n = nodeBy[s.id]; if (!n) continue;
      const k = (s.ease || eInOutQuint)(clamp((t - s.a) / (s.b - s.a)));
      n.cr = k;
      applyC(n);
      const a = anchor(n, k, 0);
      st.x = a.x; st.y = a.y; st.rot = a.rot;
      from = { x: a.x, y: a.y, rot: a.rot };
      if (t < s.b) break;
    } else {
      const goal = s.to.dock
        ? { x: vw - clipW * 0.62, y: vh - clipW * 0.42, rot: -16 }
        : (() => { const n = nodeBy[s.to.id]; return n ? anchor(n, s.to.c, 0) : { x: 0, y: 0, rot: 0 }; })();
      const base = from || st;
      const k = eInOutCubic(clamp((t - s.a) / (s.b - s.a)));
      const cx = (base.x + goal.x) / 2 + (goal.y - base.y) * 0.16;
      const cy = (base.y + goal.y) / 2 - (goal.x - base.x) * 0.16;
      const u = 1 - k;
      st.x = u * u * base.x + 2 * u * k * cx + k * k * goal.x;
      st.y = u * u * base.y + 2 * u * k * cy + k * k * goal.y;
      st.rot = lerpAng(base.rot, goal.rot, k);
      from = { x: st.x, y: st.y, rot: st.rot };
      if (t < s.b) break;
    }
  }
  return st;
}

function setClip(x, y, rot) {
  clip.x = x; clip.y = y; clip.rot = rot;
  clipperEl.style.transform = `translate3d(${x}px,${y}px,0) rotate(${rot}deg)`;
}

function finishIntro() {
  if (introDone) return;
  introDone = true;
  passes.filter(p => p.intro).forEach(p => { p.cr = 1; applyC(p); });
  UI.forEach(u => u.fn());
  uiDone = UI.length;
  setClip(dock().x, dock().y, dock().rot);
  introEl.classList.add('is-done');
  setTimeout(() => introEl.classList.add('is-gone'), 700);
  document.body.classList.remove('is-intro');
  clipperEl.classList.remove('is-cutting');
  edgeEl.classList.remove('is-on');
  startObservers();
  measure();
}

function runIntro(now) {
  const t = now - introT0;
  const total = REDUCED ? 900 : INTRO_END;

  if (countEl) {
    const k = clamp(t / (REDUCED ? 500 : 620));
    countEl.textContent = String(Math.round(eOutExpo(k) * 100)).padStart(3, '0');
  }
  const line = $('.intro__line');
  if (line) {
    const k = clamp(t / 460);
    line.style.transform = `translateY(-50%) scaleX(${eOutQuint(k)})`;
    const s = line.querySelector('i');
    if (s) s.style.transform = `translateX(${(t * 0.5) % 780}px)`;
    line.style.opacity = String(clamp(1 - (t - 900) / 500));
  }

  while (uiDone < UI.length && t >= (REDUCED ? 0 : UI[uiDone].t)) UI[uiDone++].fn();

  if (REDUCED) { finishIntro(); return; }

  const st = resolveIntro(t);
  setClip(st.x, st.y, st.rot);
  clipperEl.classList.toggle('is-live', t > 470);

  // which hero element is being cut right now?
  let cutting = null;
  for (const p of passes) if (p.intro && p.cr > 0.001 && p.cr < 0.999) cutting = p;
  clipperEl.classList.toggle('is-cutting', !!cutting);
  if (cutting) drawEdge(cutting, cutting.cr); else edgeEl.classList.remove('is-on');

  if (t >= total) finishIntro();
}

function skipIntro() {
  if (introDone) return;
  passes.filter(p => p.intro).forEach(p => { p.cr = 1; applyC(p); });
  finishIntro();
}

/* ─────────────────────────────  edge line  ───────────────────────────── */
function drawEdge(p, c) {
  const g = edgeGeom(p, c);
  if (c <= 0.002 || c >= 0.998) { edgeEl.classList.remove('is-on'); return; }
  if (g.horiz) {
    const h = p.doc.h + 140;
    edgeEl.style.width = '2px';
    edgeEl.style.height = h + 'px';
    edgeEl.style.left = (g.ex - 1) + 'px';
    edgeEl.style.top = (g.ey - h / 2) + 'px';
    edgeEl.style.transform = `rotate(${g.rot}deg)`;
    edgeEl.style.background =
      'linear-gradient(to bottom, transparent, rgba(223,241,255,.85) 16%, #fff 50%, rgba(223,241,255,.85) 84%, transparent)';
  } else {
    const w = p.doc.w + 140;
    edgeEl.style.width = w + 'px';
    edgeEl.style.height = '2px';
    edgeEl.style.left = (g.ex - w / 2) + 'px';
    edgeEl.style.top = (g.ey - 1) + 'px';
    edgeEl.style.transform = `rotate(${g.rot}deg)`;
    edgeEl.style.background =
      'linear-gradient(to right, transparent, rgba(223,241,255,.85) 16%, #fff 50%, rgba(223,241,255,.85) 84%, transparent)';
  }
  edgeEl.classList.add('is-on');
}

/* ─────────────────────────────  sparks  ───────────────────────────── */
const sparks = { list: [], acc: 0 };
function sizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.floor(vw * dpr); cv.height = Math.floor(vh * dpr);
  cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function emit(x, y, vx, vy, n) {
  for (let i = 0; i < n; i++) {
    if (sparks.list.length > 320) break;
    const a = Math.atan2(vy, vx) + Math.PI + (Math.random() - 0.5) * 1.9;
    const sp = 40 + Math.random() * 190;
    sparks.list.push({
      x, y,
      vx: Math.cos(a) * sp + vx * 0.35,
      vy: Math.sin(a) * sp + vy * 0.35 - 20,
      l: 0, m: 0.34 + Math.random() * 0.5,
      s: 1 + Math.random() * 1.7,
      hot: Math.random() < 0.16
    });
  }
}
function stepSparks(dt) {
  ctx.clearRect(0, 0, vw, vh);
  const l = sparks.list;
  for (let i = l.length - 1; i >= 0; i--) {
    const p = l[i];
    p.l += dt;
    if (p.l >= p.m) { l.splice(i, 1); continue; }
    p.vy += 620 * dt;
    p.vx *= (1 - 1.6 * dt);
    const px = p.x, py = p.y;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const k = 1 - p.l / p.m;
    ctx.globalAlpha = k * 0.9;
    ctx.strokeStyle = p.hot ? '#ff6a3d' : '#dff1ff';
    ctx.lineWidth = p.s * k;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ─────────────────────────────  main loop  ───────────────────────────── */
let lastScroll = 0, scrollVel = 0, marqueeX = 0, marqueeSpan = 1, lastFrame = perfNow();
let hoverCutter = null;

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  scrollY = window.scrollY || document.documentElement.scrollTop;
  scrollVel = lerp(scrollVel, scrollY - lastScroll, 0.35);
  lastScroll = scrollY;

  if (!introDone) runIntro(now);
  else scrollEngine(now, dt);

  stepSparks(dt);
  marqueeStep(dt);

  // progress rail
  const prog = clamp(scrollY / Math.max(docH - vh, 1));
  if (progBar) progBar.style.height = (prog * 100).toFixed(2) + '%';
  if (progNum) progNum.textContent = String(Math.round(prog * 100)).padStart(2, '0');
  navEl.classList.toggle('is-stuck', scrollY > 40);

  requestAnimationFrame(frame);
}

let smoothC = { node: null, v: 0 };

function scrollEngine(now, dt) {
  // 1. drive every scroll pass toward its target
  let active = null;
  for (const p of passes) {
    if (p.intro) continue;
    p.ct = clamp((scrollY - p.start) / p.len);
    p.cr = lerp(p.cr, p.ct, 1 - Math.pow(1 - 0.2, dt * 60));
    if (Math.abs(p.cr - p.ct) < 0.0015) p.cr = p.ct;
    applyC(p);
    if (p.ct > 0 && p.ct < 1) active = p;
  }

  let target;
  if (active) {
    target = anchor(active, active.cr);
    clipperEl.classList.add('is-cutting', 'is-live');
    drawEdge(active, active.cr);
    const spd = Math.hypot(target.x - clip.x, target.y - clip.y);
    if (spd > 0.4) {
      sparks.acc += dt * clamp(spd * 0.9, 40, 340);
      while (sparks.acc >= 1) {
        sparks.acc -= 1;
        emit(target.ex, target.ey, (target.x - clip.x) / Math.max(dt, .001) * 0.06,
             (target.y - clip.y) / Math.max(dt, .001) * 0.06, 1);
      }
    }
  } else {
    clipperEl.classList.remove('is-cutting');
    edgeEl.classList.remove('is-on');
    const next = passes.find(p => !p.intro && p.ct <= 0);
    target = next ? clampToScreen(flyTarget(next)) : dock();
    sparks.acc = 0;
  }

  const k = active ? 1 : 1 - Math.pow(1 - 0.11, dt * 60);
  const nx = lerp(clip.x, target.x + (active ? 0 : Math.sin(now * 0.0011) * 7), k);
  const ny = lerp(clip.y, target.y + (active ? 0 : Math.cos(now * 0.0009) * 5), k);
  const nr = lerpAng(clip.rot, target.rot, k);
  setClip(nx, ny, nr);
}

/* ─────────────────────────────  marquee  ───────────────────────────── */
function measureMarquee() {
  if (!marquee) return;
  marqueeSpan = marquee.children[0]?.getBoundingClientRect().width || 1;
}
function marqueeStep(dt) {
  if (!marquee) return;
  const base = REDUCED ? 0 : 46;
  marqueeX -= (base + Math.min(Math.abs(scrollVel) * 5.5, 420)) * dt;
  if (marqueeX <= -marqueeSpan) marqueeX += marqueeSpan;
  marquee.style.transform = `translate3d(${marqueeX.toFixed(2)}px,0,0)`;
}

/* ─────────────────────────────  observers  ───────────────────────────── */
function startObservers() {
  const io = new IntersectionObserver(es => {
    es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  $$('[data-reveal],[data-fade],[data-reveal-group],[data-fade-group]').forEach(el => {
    if (el.closest('.hero')) return;
    io.observe(el);
  });

  // counters
  const cio = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      cio.unobserve(e.target);
      const el = e.target, to = parseInt(el.dataset.count, 10) || 0, suf = el.dataset.suffix || '';
      const t0 = perfNow(), dur = 1500;
      const tick = () => {
        const k = clamp((perfNow() - t0) / dur);
        const v = Math.round(eOutExpo(k) * to);
        el.textContent = (to >= 1000 ? v.toLocaleString('en-US') : v) + (k >= 1 ? suf : '');
        if (k < 1) requestAnimationFrame(tick);
      };
      tick();
    });
  }, { threshold: 0.5 });
  $$('[data-count]').forEach(el => cio.observe(el));

  // active nav link
  const nio = new IntersectionObserver(es => {
    es.forEach(e => {
      const link = $(`.nav__links a[href="#${e.target.id}"]`);
      if (link && e.isIntersecting) {
        $$('.nav__links a').forEach(a => a.classList.remove('is-active'));
        link.classList.add('is-active');
      }
    });
  }, { threshold: 0.3 });
  ['pass', 'work', 'menu', 'man', 'book'].forEach(id => { const s = document.getElementById(id); if (s) nio.observe(s); });
}

/* ─────────────────────────────  cursor + magnetic  ───────────────────────────── */
function initPointer() {
  const cur = $('.cursor');
  if (!cur || matchMedia('(pointer:coarse)').matches) return;
  const dot = cur.querySelector('.cursor__dot'), ring = cur.querySelector('.cursor__ring');
  let mx = vw / 2, my = vh / 2, rx = mx, ry = my, dx = mx, dy = my;

  addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; cur.classList.remove('is-hidden'); }, { passive: true });
  addEventListener('pointerleave', () => cur.classList.add('is-hidden'));

  const loop = () => {
    dx = lerp(dx, mx, 0.35); dy = lerp(dy, my, 0.35);
    rx = lerp(rx, mx, 0.16); ry = lerp(ry, my, 0.16);
    dot.style.transform = `translate(${dx}px,${dy}px) translate(-50%,-50%)`;
    ring.style.transform = `translate(${rx}px,${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(loop);
  };
  loop();

  $$('[data-cursor]').forEach(el => {
    const kind = el.dataset.cursor;
    el.addEventListener('pointerenter', () => cur.classList.add(kind === 'cut' ? 'is-cut' : 'is-link'));
    el.addEventListener('pointerleave', () => cur.classList.remove('is-cut', 'is-link'));
  });

  $$('[data-magnetic]').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.22;
      const y = (e.clientY - r.top - r.height / 2) * 0.3;
      el.style.transform = `translate(${x}px,${y}px)`;
      el.style.transition = 'transform .1s linear';
    });
    el.addEventListener('pointerleave', () => {
      el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)';
      el.style.transform = 'translate(0,0)';
    });
  });
}

/* ─────────────────────────────  boot  ───────────────────────────── */
function boot() {
  buildPasses();
  indexNodes();
  sizeCanvas();
  measureMarquee();
  measure();

  // park the clipper off-stage until the first pass
  setClip(-clipW, vh * 0.5, 0);

  introT0 = perfNow();
  const skip = () => skipIntro();
  addEventListener('wheel', skip, { once: true, passive: true });
  addEventListener('touchstart', skip, { once: true, passive: true });
  addEventListener('keydown', skip, { once: true });
  introEl.addEventListener('click', skip);

  initPointer();
  requestAnimationFrame(t => { lastFrame = t; frame(t); });
}

let rz;
addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => { sizeCanvas(); measureMarquee(); measure(); }, 160);
}, { passive: true });

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { measureMarquee(); if (introDone) measure(); });
}
addEventListener('load', () => { measureMarquee(); if (introDone) measure(); });

boot();
})();
