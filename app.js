// 眉妆跟练 v1 · 页面控制（D41）
// 屏幕顺序在 lib/flow.js，定位几何在 lib/browGuide.js，文字与片段在 content.js，记录在 lib/log.js。
// 这里只负责：拍照 → 本机识别 → 画在你自己的照片上 → 一屏一屏往下走 → 生成文字结果。
import { FOLLOW_CONTENT as C } from './content.js';
import { contentReadiness } from './lib/readiness.js';
import { buildScreens, nextIndex, backIndex, screenLabel, indexOf } from './lib/flow.js';
import { computeBrowGuide, subPath, viewRect, referenceLines } from './lib/browGuide.js';
import { mirrorPoint } from './lib/mirror.js';
import { createLog, summarize } from './lib/log.js';
import { mountStrokeDemo } from './demo/mount.js';
import { frameAt, timeline, readout, strokeMarks } from './lib/strokeDemo.js';
import { renderSvg } from './lib/strokeRender.js';
import { analyzeRoi, roiOf, buildOwnScript, demoSide, practiceSides, overviewCrop } from './lib/ownScript.js';

// 与根目录 app.js 相同的版本、模型与选项（已在真机验证）；单独加载，让 follow/ 能独立托管。
const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
// D30/D31：getUserMedia 的约束作用在与绘制空间转置的空间里，所以请求横向比例才得到竖向帧。
const STAGE_ASPECT_TRANSPOSED = 956 / 440;
const MAX_SIDE = 1600; // 相册大图先缩小，识别够用，也省内存

const DEV = new URLSearchParams(location.search).has('dev');
// 开发用：skip=0 / 1 把镜子里左边 / 右边那条当成不用补，验收"只补一边"（现有测试照片里没有这种）
const DEV_SKIP = DEV ? new URLSearchParams(location.search).get('skip') : null;
// 开发：?clock=interval 让三笔示范用定时器走（浏览器面板隐藏时 rAF 不触发）
const DEMO_CLOCK = new URLSearchParams(location.search).get('clock') === 'interval' ? 'interval' : 'raf';
let strokeDemo = null; // 当前屏上挂着的三笔示范（离开这一屏时销毁）
let board = null;      // 当前屏上的布局 D 面板（练习屏、自查屏）
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor"/></svg>',
};
const TOOL_ICON = {
  pencil: '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M14 50 L46 18 L52 24 L20 56 Z"/><path d="M14 50 L10 60 L20 56"/><path d="M46 18 L50 14 L56 20 L52 24"/></g><path d="M10 60 L12.5 54.5 L15.5 57.5 Z" fill="currentColor"/></svg>',
  brush: '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 56 L36 32"/><path d="M36 32 L52 16"/><path d="M38 24 l6 6 M42 20 l6 6 M46 16 l6 6 M36 30 l-4 -4 M40 26 l-4 -4 M44 22 l-4 -4 M48 18 l-4 -4"/></g></svg>',
};
const SIGNAL = '#0E6F68';
const SIDE_NAME = ['镜子里左边', '镜子里右边'];

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const modal = document.getElementById('modal');

const screens = buildScreens(C.steps);
const readiness = contentReadiness(C);
const log = createLog();
const startedAt = new Date();

const state = {
  i: 0,
  stream: null,
  photo: null,       // { canvas, W, H, source: 'camera'|'file'|'dev', mirrored }
  display: null,     // 按显示方向画好的照片
  landmarks: null,
  overrides: { left: {}, right: {} },
  guide: null,
  sideOrder: ['left', 'right'], // [镜子里左边那条, 右边那条] 对应的 left/right
  view: null,
  drag: null,
  wantAwake: false,
  survey: { answered: [] },
  endT: null,
};

// ---------- 小工具 ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fill = (s) => s.replace('{feedbackTo}', C.feedbackTo);
const labelOf = (id) => screenLabel(screens[indexOf(screens, id)], C.steps);
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const toDisp = (p) => (state.photo.mirrored ? mirrorPoint(p, state.photo.W) : p);
const fromDisp = toDisp; // 镜像是它自己的逆

// ---------- 屏幕常亮（镜前那几屏会停留很久） ----------
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支持就算了 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.wantAwake) keepAwake();
});

// ---------- 内容未就绪横幅 ----------
function renderBanner() {
  if (readiness.ready) return;
  banner.hidden = false;
  document.body.classList.add('has-banner');
  const adv = readiness.advisory.length
    ? `<div>另外建议：${readiness.advisory.map((a) => esc(a.what)).join('；')}</div>` : '';
  banner.innerHTML = `<details>
    <summary>内容未就绪：还缺 ${readiness.blocking.length} 项，这个链接先不要发出去</summary>
    <ul>${readiness.blocking.map((b) => `<li>${esc(b.what)}</li>`).join('')}</ul>${adv}</details>`;
}

// ---------- 导航 ----------
function go(i, kind = 'next') {
  const from = screens[state.i];
  if (kind === 'back') log.add('back', { from: from.id, to: screens[i].id });
  if (kind === 'jump') log.add('jump', { from: from.id, to: screens[i].id });
  leave(from);
  state.i = i;
  log.add('screen', { id: screens[i].id });
  render();
  window.scrollTo(0, 0);
}
const next = () => go(nextIndex(screens, state.i));
const back = () => go(backIndex(screens, state.i), 'back');

function leave(screen) {
  if (screen.id === 'capture') stopCamera();
  app.querySelectorAll('video').forEach((v) => v.pause());
  strokeDemo?.destroy();
  strokeDemo = null;
  board = null;
}

function shell({ chip = '', moment = '', media = '', body = '', actions = '', minor = 'both' }) {
  const minorHtml = minor === false ? '' : `<div class="minor">
      <button class="text-btn" data-act="back">返回</button>
      ${minor === 'both' ? '<button class="text-btn" data-act="stuck">卡住了</button>' : '<span></span>'}
    </div>`;
  app.innerHTML = `
    <div class="top"><span class="chip">${esc(chip)}</span><span class="moment">${esc(moment)}</span></div>
    ${media}
    <div class="body">${body}</div>
    <div class="actions">${actions}</div>
    ${minorHtml}`;
}

const stepChip = (s) => (C.steps.length > 1 ? `${s.step + 1}/${C.steps.length} · ` : '') + C.steps[s.step].title;

function render() {
  const s = screens[state.i];
  if (s.id === 'intro') return renderIntro();
  if (s.id === 'capture') return renderCapture('idle'); // 回到拍照页总是从头来：相机已关、识别中的状态不保留
  if (s.id === 'confirm') return renderConfirm();
  if (s.id === 'survey') return renderSurvey();
  if (s.id === 'summary') return renderSummary();
  if (!state.guide) return go(indexOf(screens, 'capture'), 'jump'); // 没有照片不能往下走
  if (s.moment === 'practice') return renderPractice(s);
  if (s.moment === 'check') return renderCheck(s);
}

// ---------- 入口 ----------
function renderIntro() {
  const I = C.intro;
  shell({
    chip: '画眉', minor: false,
    media: `<div class="tools">${I.tools.map((t) => `<figure class="tool">${TOOL_ICON[t.icon] || ''}
      <figcaption>${esc(t.name)}${t.note ? `<small>${esc(t.note)}</small>` : ''}</figcaption></figure>`).join('')}</div>`,
    body: `<h1 class="say big">${esc(I.title)}</h1>${C.durationMinutes ? `<p class="sub">约 ${C.durationMinutes} 分钟</p>` : ''}`,
    actions: `<button class="primary" data-act="start">开始</button>
      <button class="text-btn info" data-act="info" data-info="intro">ⓘ 说明</button>`,
  });
}

// ---------- 拍照 ----------
function renderCapture(mode, msg = '') {
  const chip = '拍照';
  if (mode === 'live') {
    shell({
      chip,
      media: '<div class="media cam"><video id="cam" class="mirror" playsinline muted autoplay></video></div>',
      body: '<p class="say">脸放中间，平视</p>',
      actions: '<button class="primary" data-act="shoot">拍照</button>',
    });
    const v = document.getElementById('cam');
    v.srcObject = state.stream;
    v.play().catch(() => {});
    return;
  }
  if (mode === 'busy') {
    shell({
      chip, minor: false,
      body: '<p class="say">正在识别，第一次稍慢</p>',
    });
    return;
  }
  shell({
    chip,
    body: `<p class="say">${esc(C.capture.line)}</p><p class="sub lock">${esc(C.capture.privacy)}</p>
      ${msg ? `<div class="why"><b>${esc(msg)}</b></div>` : ''}`,
    actions: `<button class="primary" data-act="openCamera">打开前置相机</button>
      <button class="secondary" data-act="pickFile">从相册选</button>
      ${DEV ? '<button class="secondary" data-act="devFace">（开发）用合成脸测试</button>' : ''}
      <input type="file" accept="image/*" id="file" hidden>`,
  });
  document.getElementById('file').addEventListener('change', onFile);
  getLandmarker().catch(() => {}); // 提前下载模型，减少拍完后的等待
}

async function openCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1920 }, aspectRatio: { ideal: STAGE_ASPECT_TRANSPOSED } },
      audio: false,
    });
    renderCapture('live');
  } catch {
    renderCapture('idle', '没能打开相机（可能没有授权）。可以改用"从相册选一张"。');
  }
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

async function shoot() {
  const v = document.getElementById('cam');
  if (!v?.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); // canonical_unmirrored：不在这里镜像
  stopCamera();
  await usePhoto(c, 'camera');
}

function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = async () => {
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    await usePhoto(c, 'file');
  };
  img.onerror = () => renderCapture('idle', '这张图片打不开，换一张试试。');
  img.src = url;
}

async function devFace() {
  const { syntheticFace, drawSyntheticFace } = await import('./lib/syntheticFace.js');
  const f = syntheticFace({ W: 900, H: 1170 });
  const c = document.createElement('canvas');
  c.width = f.W;
  c.height = f.H;
  drawSyntheticFace(c.getContext('2d'), f.W, f.H);
  await usePhoto(c, 'dev', f.landmarks);
}

let landmarkerPromise = null;
function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await import(MP_URL);
      const vision = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
      const make = (delegate) => FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'IMAGE',
        numFaces: 2, // 用来发现"画面里不止一张脸"
      });
      try { return await make('GPU'); } catch { return make('CPU'); }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; }); // 失败了下次重试
  }
  return landmarkerPromise;
}

async function usePhoto(canvas, source, devLandmarks = null) {
  renderCapture('busy');
  try {
    let landmarks = devLandmarks;
    if (!landmarks) {
      const result = (await getLandmarker()).detect(canvas);
      const faces = result.faceLandmarks || [];
      if (faces.length === 0) return renderCapture('idle', '没找到脸。请正对镜头、光线亮一点，再拍一次。');
      if (faces.length > 1) return renderCapture('idle', '画面里不止一张脸，请只留你自己再拍一次。');
      landmarks = faces[0];
    }
    state.photoUrlPromise?.then((u) => URL.revokeObjectURL(u));
    state.photoUrlPromise = null;
    state.own = null;
    state.photo = { canvas, W: canvas.width, H: canvas.height, source, mirrored: true };
    state.landmarks = landmarks;
    state.overrides = { left: {}, right: {} };
    rebuildDisplay();
    recompute();
    go(indexOf(screens, 'confirm'));
  } catch (err) {
    console.error(err);
    renderCapture('idle', '识别没有成功，可能是网络不好、模型没下载下来。请稍后再试一次。');
  }
}

// ---------- 显示方向与定位 ----------
function rebuildDisplay() {
  const { canvas, W, H, mirrored } = state.photo;
  const d = document.createElement('canvas');
  d.width = W;
  d.height = H;
  const ctx = d.getContext('2d');
  if (mirrored) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(canvas, 0, 0);
  state.display = d;
}

function recompute() {
  state.guide = computeBrowGuide(state.landmarks, state.photo.W, state.photo.H, state.overrides);
  // 镜子里的左右按显示方向排：起笔点在显示坐标里更靠左的那条，就是"镜子里左边"
  state.sideOrder = ['left', 'right'].sort(
    (a, b) => toDisp(state.guide.sides[a].start).x - toDisp(state.guide.sides[b].start).x
  );
}

// ---------- 画面 ----------
function setupCanvas(el) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = el.getBoundingClientRect();
  el.width = Math.max(1, Math.round(r.width * dpr));
  el.height = Math.max(1, Math.round(r.height * dpr));
  return { ctx: el.getContext('2d'), cssW: r.width, cssH: r.height, dpr };
}

// points：要框进画面的点（canonical）；padD：四周留白，单位是两眼外角距离
function drawView(el, points, padD, overlay) {
  const { ctx, cssW, cssH, dpr } = setupCanvas(el);
  const D = state.guide.eyeDistance;
  const rect = viewRect(points.map(toDisp), padD * D, cssW / cssH);
  const k = (cssW * dpr) / rect.w;
  ctx.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
  ctx.fillStyle = '#E7DED3';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.drawImage(state.display, 0, 0);
  const px = dpr / k; // 1 个 CSS 像素 = 多少照片像素，用来让线宽、字号在屏幕上保持不变
  overlay(ctx, px);
  state.view = { el, rect, k, dpr };
}

// 空心圆圈 + 圆心小点：圈里看得见自己的眉毛（实心点会把眉头、眉尾正好盖住——2026-10-07 真人照片上发现）
function dot(ctx, p, px, label, r = 8) {
  ctx.save();
  ctx.lineWidth = 5 * px; ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.beginPath(); ctx.arc(p.x, p.y, r * px, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.5 * px; ctx.strokeStyle = SIGNAL;
  ctx.beginPath(); ctx.arc(p.x, p.y, r * px, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = SIGNAL;
  ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 * px, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (!label) return;
  ctx.font = `600 ${14 * px}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 4 * px;
  ctx.strokeStyle = 'rgba(255,255,255,.92)';
  ctx.strokeText(label, p.x, p.y - (r + 9) * px);
  ctx.fillStyle = SIGNAL;
  ctx.fillText(label, p.x, p.y - (r + 9) * px);
}

// 鼻翼参照点（D43 三点三线）：小实心点，不可拖，只标出两条参照线从哪里出发
function anchor(ctx, p, px) {
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 * px, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SIGNAL;
  ctx.beginPath(); ctx.arc(p.x, p.y, 3 * px, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 引导线：先画一道白色描边，再画青绿主线——放在深色眉毛上也看得清，又不至于把眉毛整条盖住
function guide(ctx, pts, px, { width = 3, dash = null } = {}) {
  line(ctx, pts, px, { width: width + 4, alpha: 0.85, dash, color: '#FFFFFF' });
  line(ctx, pts, px, { width, dash });
}

function line(ctx, pts, px, { width = 3, alpha = 1, dash = null, color = SIGNAL } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * px;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash ? dash.map((d) => d * px) : []);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

// 路径末端的小箭头：表示"往收尾方向推进"（落点推进，不表示单笔方向——D40 (b)）
function arrowHead(ctx, a, b, px) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, s = 11 * px;
  const pts = [
    { x: b.x - ux * s - uy * s * 0.65, y: b.y - uy * s + ux * s * 0.65 },
    b,
    { x: b.x - ux * s + uy * s * 0.65, y: b.y - uy * s - ux * s * 0.65 },
  ];
  guide(ctx, pts, px, { width: 3.5 });
}

const sideOf = (key) => state.guide.sides[key];
const dispPath = (pts) => pts.map(toDisp);

// ---------- 确认起笔和收尾（可拖动） ----------
function renderConfirm() {
  shell({
    chip: C.ui.confirmChip,
    media: '<div class="media"><canvas id="view"></canvas></div>',
    body: `<p class="say">${esc(C.confirm.line)}</p>
      <figure class="rule-diagram">${ruleDiagram(C.confirm.diagram)}<figcaption>${esc(C.confirm.why)}</figcaption></figure>`,
    actions: `${state.photo.source !== 'camera' ? '<button class="secondary" data-act="flip">左右反了？翻转</button>' : ''}
      <button class="primary" data-act="confirm">就是这里</button>`,
  });
  drawConfirm();
  const el = document.getElementById('view');
  el.addEventListener('pointerdown', onDragStart);
  el.addEventListener('pointermove', onDragMove);
  el.addEventListener('pointerup', onDragEnd);
  el.addEventListener('pointercancel', onDragEnd);
}

// 起笔收尾的找法示意（L'Oréal 加拿大页 Step 1）：鼻孔外缘竖直向上 → 起笔；鼻孔外缘经外眼角延长 → 收尾。
// 几何：鼻 (96,136) → 外眼角 (205,78) 方向延长到眉高 y≈40，得收尾 (276,40)。
function ruleDiagram([nose, eye, start, end]) {
  const t = (x, y, s, a = 'middle') => `<text x="${x}" y="${y}" text-anchor="${a}">${esc(s)}</text>`;
  return `<svg viewBox="0 0 320 156" role="img" aria-label="${esc(`${nose}竖直向上是${start}，${nose}经过${eye}延长是${end}`)}">
    <path d="M96 38 Q180 12 276 40" fill="none" stroke="#8C7768" stroke-width="9" stroke-linecap="round"/>
    <path d="M120 80 Q160 60 205 78 Q160 96 120 80 Z" fill="#FFFDF9" stroke="#6B5F57" stroke-width="2"/>
    <circle cx="160" cy="79" r="7" fill="#6B5F57"/>
    <g stroke="${SIGNAL}" stroke-width="2" stroke-dasharray="5 5" fill="none"><path d="M96 136 L96 38"/><path d="M96 136 L276 40"/></g>
    <circle cx="205" cy="78" r="3" fill="${SIGNAL}"/>
    <circle cx="96" cy="136" r="5" fill="${SIGNAL}" stroke="#fff" stroke-width="2"/>
    <g fill="none" stroke="${SIGNAL}" stroke-width="2.5"><circle cx="96" cy="38" r="7"/><circle cx="276" cy="40" r="7"/></g>
    <g class="lbl">${t(96, 20, start)}${t(276, 22, end)}${t(106, 150, nose, 'start')}${t(214, 98, eye, 'start')}</g>
  </svg>`;
}

// 确认页的取景只按"自动算出的点"来框：拖动时画面不跟着缩放，手指下的位置才稳定
function confirmFramePoints() {
  const pts = [];
  for (const key of ['left', 'right']) {
    const s = sideOf(key);
    const up = 0.16 * state.guide.eyeDistance; // 给眉峰和标签留出上方空间
    pts.push(s.auto.start, s.auto.end, s.eyeOuter, s.noseWing,
      { x: s.auto.start.x, y: s.auto.start.y - up }, { x: s.auto.end.x, y: s.auto.end.y - up });
  }
  return pts;
}

function drawConfirm() {
  const el = document.getElementById('view');
  if (!el) return;
  drawView(el, confirmFramePoints(), 0.14, (ctx, px) => {
    for (const key of ['left', 'right']) {
      const s = sideOf(key);
      // 三点三线（D43）：鼻翼 → 起笔、鼻翼 → 收尾、眉线，都连到当前位置；拖动时一起动
      const L = referenceLines(s);
      line(ctx, L.toStart.map(toDisp), px, { width: 1.5, alpha: 0.7, dash: [5, 5] });
      line(ctx, L.toEnd.map(toDisp), px, { width: 1.5, alpha: 0.7, dash: [5, 5] });
      line(ctx, dispPath(L.brow), px, { width: 1.5, alpha: 0.9, dash: [4, 4] });
      anchor(ctx, toDisp(s.noseWing), px);
      dot(ctx, toDisp(s.start), px, '起笔', 10);
      dot(ctx, toDisp(s.end), px, '收尾', 10);
    }
  });
}

function eventToPhoto(e) {
  const { el, rect, k, dpr } = state.view;
  const r = el.getBoundingClientRect();
  return { x: rect.x + ((e.clientX - r.left) * dpr) / k, y: rect.y + ((e.clientY - r.top) * dpr) / k };
}

function onDragStart(e) {
  const p = eventToPhoto(e);
  const reach = (32 * state.view.dpr) / state.view.k; // 手指 32 CSS 像素以内算点中
  let best = null;
  for (const key of ['left', 'right']) {
    for (const which of ['start', 'end']) {
      const q = toDisp(sideOf(key)[which]);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < reach && (!best || d < best.d)) best = { key, which, d };
    }
  }
  if (!best) return;
  state.drag = best;
  e.currentTarget.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onDragMove(e) {
  if (!state.drag) return;
  const { key, which } = state.drag;
  state.overrides[key][which] = fromDisp(eventToPhoto(e)); // 存回 canonical 坐标，翻转后仍贴在同一个解剖位置
  recompute();
  drawConfirm();
}

function onDragEnd() {
  state.drag = null;
}

function confirmPoints() {
  const D = state.guide.eyeDistance;
  const off = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / D;
  log.add('points', {
    source: state.photo.source,
    flipped: !state.photo.mirrored,
    sides: state.sideOrder.map((key, n) => {
      const s = sideOf(key);
      return { label: SIDE_NAME[n], startOff: off(s.start, s.auto.start), endOff: off(s.end, s.auto.end) };
    }),
  });
  next();
}

function flip() {
  state.photo.mirrored = !state.photo.mirrored;
  log.add('flip', { mirrored: state.photo.mirrored });
  rebuildDisplay();
  recompute();
  renderConfirm();
}

function renderDemo(s) {
  const st = C.steps[s.step];
  if ((st.clip.kind === 'strokes' || st.clip.kind === 'own-photo') && st.clip.src) return renderStrokeDemo(s, st);
  const media = st.clip.src
    ? `<div class="media tall"><video id="clip" src="${esc(st.clip.src)}" playsinline muted preload="auto"></video></div>`
    : `<div class="media tall"><div class="clip-missing"><div><b>示范还没准备好</b><br>需要：${esc(st.clip.need)}</div></div></div>`;
  shell({
    chip: stepChip(s),
    media,
    actions: `<button class="secondary" data-act="replay"${st.clip.src ? '' : ' disabled'}>再看一遍</button>
      <button class="primary" data-act="next">去画</button>`,
  });
  document.getElementById('clip')?.play().catch(() => {}); // 进来播一次，不循环
}

// D42 三笔示范（只画笔、不画手）。按跟练里一贯的镜子方向显示：示范的是被拍者右眉，镜像后出现在"镜子里右边"。
// 镜像只改显示；画左边那条时要左右反过来，这一点写在画面上，是否需要另做一条，由真机测试判断。
function renderStrokeDemo(s, st) {
  shell({
    chip: stepChip(s),
    media: `<div class="player">
      <div class="media stroke"><div class="stroke-stage" id="strokeStage"></div>
        <span class="badge">${esc(C.ui.demoBadge)}</span>
        <p class="stage-sub" id="strokeCaption" aria-live="polite"></p></div>
      <div class="controls">
        <button class="ctl" data-act="demoToggle" id="demoToggle" aria-label="暂停">${ICON.pause}</button>
        <div class="bar" aria-hidden="true"><div class="fill" id="demoFill"></div><span id="demoMarks"></span></div>
        ${st.clip.kind === 'own-photo' ? '' : '<span class="count" id="demoCount"></span>'}
        <button class="ctl" data-act="replay" id="demoReplay" aria-label="重播">${ICON.replay}</button>
      </div></div>`,
    actions: '<button class="primary" data-act="next">去画</button>',
  });
  const stage = document.getElementById('strokeStage');
  const own = st.clip.kind === 'own-photo';
  const scriptP = own ? ownScript('demo') : import(`./${st.clip.src}`).then((m) => m.STROKE_DEMO);
  scriptP.then((STROKE_DEMO) => {
    if (!stage.isConnected) return; // 已经离开这一屏
    if (STROKE_DEMO.still) { // 两条眉都不用补（demoSide 已优先挑有笔的那条）：照片照常显示，提示放左下角
      stage.innerHTML = stillSvg(STROKE_DEMO, own ? state.photo.mirrored : true, stage.id) + `<p class="stage-note">${esc(C.ui.noneToFill)}</p>`;
      document.querySelector('.player .controls')?.setAttribute('hidden', '');
      skipLabel();
      return;
    }
    document.getElementById('demoMarks').innerHTML = strokeMarks(STROKE_DEMO)
      .map((m) => `<i style="left:${(m * 100).toFixed(2)}%"></i>`).join('');
    strokeDemo = mountStrokeDemo(stage, STROKE_DEMO, {
      mirror: own ? state.photo.mirrored : true, // 本人照片跟跟练里其他屏同一个镜像方向
      clock: DEMO_CLOCK,
      onChange(player, f) {
        const r = readout(player);
        const cap = document.getElementById('strokeCaption');
        const btn = document.getElementById('demoToggle');
        const fill = document.getElementById('demoFill');
        const count = document.getElementById('demoCount');
        if (cap) cap.textContent = f.subtitle;
        if (fill) fill.style.width = `${(r.fraction * 100).toFixed(2)}%`;
        if (count) count.textContent = `第 ${r.stroke}/${r.strokes} 笔`; // 只有旧的笔触片段有计数；本人照片示范不计数（字幕已写眉头／眉身／眉尾）
        const again = document.getElementById('demoReplay');
        if (again) again.hidden = r.state === 'ended'; // 播完后左边按钮就是重播，不重复出现
        if (btn) {
          const icon = r.state === 'playing' ? 'pause' : r.state === 'paused' ? 'play' : 'replay';
          btn.innerHTML = ICON[icon];
          btn.setAttribute('aria-label', { pause: '暂停', play: '继续', replay: '重播' }[icon]);
        }
      },
    });
  });
}

// 没有东西要画时（两条眉都不用补，很少见）：主按钮改为"跳过"，照常往下走
const skipLabel = () => { const b = document.querySelector('.primary[data-act="next"]'); if (b) b.textContent = C.ui.skip; };

// ---------- 布局 D：上面双眉总览 + 下面放大一条（练习屏、自查屏共用；2026-10-11 Nicole 定） ----------
// 总览 = 双眉 + 眼睛上部 + 一点鼻梁（overviewCrop），左右位置和镜子里一致，只留起笔、收尾小点；当前这条眉加框，上方标签实心。
// 放大 = 当前这条眉：先示范它自己要补的几组，再停在它的目标示意；新加的笔先用青绿色标一下，再淡回自然眉色。
// 两条眉分开练：先镜子里右边、再镜子里左边（practiceSides），用户不用选边；不用补的那条在标签上注明。
const MARK = '#14A897'; // 新加的笔的临时标色：比主题色亮，不用叠底（叠底会被压暗，和深色眉毛分不开）
const STILL = { reveal: [], hint: { visible: false }, pencil: { visible: false }, blend: 0 };
const stillSvg = (script, mirror, idPrefix) => renderSvg(STILL, script, { mirror, showPencil: false, idPrefix });

function boardMedia() {
  return `<div class="board">
    <div class="board-tags" id="boardTags"></div>
    <div class="media overview" id="overview"><div class="stroke-stage" id="overviewStage"></div><div class="overview-marks" id="overviewMarks"></div></div>
    <div class="media stroke zoom" id="zoomCard" hidden><div class="stroke-stage" id="zoomStage"></div>
      <span class="badge" id="zoomBadge">${esc(C.ui.demoBadge)}</span><p class="stage-sub" id="zoomCap" aria-live="polite"></p>
      <button class="pill" id="beforeBtn" aria-pressed="false" hidden>${esc(C.ui.showBefore)}</button></div>
  </div>`;
}

// withTarget：总览画上两条眉的目标示意（自查）；否则只是原来的照片（练习）
function mountBoard({ withTarget = false } = {}) {
  const own = ownSides();
  const order = state.sideOrder; // [镜子里左边那条, 镜子里右边那条]
  const seq = practiceSides(own.sides, order); // 要练的边，先镜子里右边
  const mirror = state.photo.mirrored;
  const crop = overviewCrop({ left: sideOf('left'), right: sideOf('right') });
  const el = (id) => document.getElementById(id);
  // 每次开始播放 / 换边都换一个序号；异步加载回来时序号已过期（用户中途点了"这边画好了"或离开了这一屏）就放弃，免得旧的盖掉新的
  let run = 0;
  const fresh = (my) => my === run && !!el('overview')?.isConnected;
  const sayLine = (t) => { if (el('practiceSay')) el('practiceSay').textContent = t; };
  const replayBtn = (show) => { if (el('replayBtn')) el('replayBtn').hidden = !show; };
  el('overview').style.aspectRatio = `${crop.w} / ${crop.h}`;

  const before = el('beforeBtn');
  const setBefore = (on) => {
    before.setAttribute('aria-pressed', String(on));
    before.textContent = on ? C.ui.showAfter : C.ui.showBefore;
    el('zoomBadge').textContent = on ? C.ui.beforeBadge : C.ui.targetBadge;
    el('zoomStage').classList.toggle('before', on);
  };
  before.addEventListener('click', () => setBefore(before.getAttribute('aria-pressed') !== 'true'));

  let shown = null; // 总览上当前加框的那条眉
  async function paintOverview(current, my) {
    const base = await ownScriptFor(withTarget ? { which: 'target' } : { which: 'demo', groups: [] });
    if (!fresh(my)) return false;
    const frame = withTarget && !base.still ? frameAt(base, timeline(base).total) : STILL;
    el('overviewStage').innerHTML = renderSvg(frame, { ...base, scene: { ...base.scene, crop } }, { mirror, showPencil: false, idPrefix: 'ov' });
    shown = current;
    placeMarks();
  }
  // 小点、框、标签按屏幕像素摆；转屏后重摆一次（不打断示范）
  function placeMarks() {
    if (!el('overview')) return;
    const current = shown;
    const W = el('overview').clientWidth; const H = el('overview').clientHeight;
    const toCss = (p) => ({ x: ((mirror ? crop.x + crop.w - p.x : p.x - crop.x) / crop.w) * W, y: ((p.y - crop.y) / crop.h) * H });
    let marks = '';
    for (const key of ['left', 'right']) {
      for (const p of [sideOf(key).start, sideOf(key).end]) { const c = toCss(p); marks += `<i class="end-dot" style="left:${c.x.toFixed(1)}px;top:${c.y.toFixed(1)}px"></i>`; }
    }
    if (current) { // 当前这条眉：一圈主题色框，收在照片里面
      const ps = sideOf(current).path.map(toCss);
      const m = (sideOf(current).bandHalf / crop.w) * W * 1.4;
      const l = Math.max(3, Math.min(...ps.map((p) => p.x)) - m); const r = Math.min(W - 3, Math.max(...ps.map((p) => p.x)) + m);
      const t = Math.max(3, Math.min(...ps.map((p) => p.y)) - m); const b = Math.min(H - 3, Math.max(...ps.map((p) => p.y)) + m);
      marks += `<div class="ov-frame" style="left:${l.toFixed(1)}px;top:${t.toFixed(1)}px;width:${(r - l).toFixed(1)}px;height:${(b - t).toFixed(1)}px"></div>`;
    }
    el('overviewMarks').innerHTML = marks;
    // 标签对齐各自眉毛的中点，但不超出照片左右边缘；两条都不用补时下面那句已经说了，标签只写左右
    el('boardTags').innerHTML = order.map((key, n) => {
      const skip = seq.length > 0 && !own.sides[key].plan.length;
      return `<span class="side-tag${key === current ? ' on' : ''}${skip ? ' off' : ''}">${esc(SIDE_NAME[n])}${skip ? ` · ${esc(C.ui.sideSkip)}` : ''}</span>`;
    }).join('');
    el('boardTags').querySelectorAll('.side-tag').forEach((tag, n) => {
      const ps = sideOf(order[n]).path.map(toCss);
      const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      const half = tag.offsetWidth / 2;
      tag.style.left = `${Math.min(W - half, Math.max(half, cx)).toFixed(1)}px`;
    });
  }

  // 放大图：示范这一条眉自己要补的几组；播完（waiting）结束
  async function playDemo(side, my) {
    el('zoomCard').hidden = false;
    before.hidden = true; setBefore(false);
    el('zoomBadge').textContent = C.ui.demoBadge;
    const [demo, tgt] = await Promise.all([ownScriptFor({ which: 'demo', side }), ownScriptFor({ which: 'target', only: side })]);
    const script = { ...demo, scene: { ...demo.scene, crop: tgt.scene.crop } }; // 和目标示意同一个取景，播完切过去不跳
    if (!fresh(my)) return false;
    const stage = el('zoomStage');
    return new Promise((resolve) => {
      let done = false;
      strokeDemo?.destroy();
      strokeDemo = mountStrokeDemo(stage, script, {
        mirror, clock: DEMO_CLOCK,
        onChange(player, f) {
          if (el('zoomCap')) el('zoomCap').textContent = f.subtitle;
          if (!done && player.status === 'waiting') { done = true; setTimeout(() => resolve(fresh(my)), 400); }
        },
      });
    });
  }
  // 放大图：这一条眉的目标示意。上面叠一层青绿色的同一组笔，淡出后露出自然眉色（临时高亮）
  async function showTarget(side, my) {
    const script = await ownScriptFor({ which: 'target', only: side });
    if (!fresh(my)) return false;
    strokeDemo?.destroy(); strokeDemo = null;
    const stage = el('zoomStage');
    el('zoomCap').textContent = '';
    const end = frameAt(script, timeline(script).total);
    const marked = { ...script, style: { ...script.style, color: MARK, opacity: 0.95, blendMode: 'normal' } };
    stage.innerHTML = renderSvg(end, script, { mirror, showPencil: false, idPrefix: 'zn' })
      + `<div class="mark-layer">${renderSvg({ ...end, blend: 0 }, marked, { mirror, showPencil: false, idPrefix: 'zm' })}</div>`;
    setBefore(false);
    before.hidden = false;
    return true;
  }

  let idx = 0;
  async function runSide() {
    const my = ++run;
    const side = seq[idx];
    const last = idx === seq.length - 1;
    if (el('practiceNext')) el('practiceNext').textContent = last ? C.ui.drawDone : C.ui.sideDone;
    sayLine(''); replayBtn(false);
    if (await paintOverview(side, my) === false) return;
    if (!(await playDemo(side, my))) return;
    if (!(await showTarget(side, my))) return;
    sayLine(side === order[1] ? C.ui.drawRight : C.ui.drawLeft);
    replayBtn(true);
  }

  return {
    // 练习：按顺序一边一边来；两条都不用补时只放总览
    async startPractice() {
      if (!seq.length) {
        if (await paintOverview(null, ++run) === false) return;
        sayLine(C.ui.noneToFill);
        if (el('practiceNext')) el('practiceNext').textContent = C.ui.skip;
        return;
      }
      idx = 0;
      runSide();
    },
    // "这边画好了"：还有下一边就切过去，返回 true；没有了返回 false（交给翻页）
    advance() {
      if (idx >= seq.length - 1) return false;
      log.add('sideDone', { side: SIDE_NAME[order.indexOf(seq[idx])] });
      idx += 1;
      runSide();
      return true;
    },
    // 自查：总览上是两条眉的目标示意；"再看示范"时放大图临时出现，按顺序示范两边，播完收起
    async startCheck() {
      if (await paintOverview(null, ++run) === false) return;
      replayBtn(seq.length > 0);
    },
    async replay() {
      if (!withTarget) return runSide();
      const my = ++run;
      replayBtn(false);
      for (const side of seq) {
        if (await paintOverview(side, my) === false) return;
        if (!(await playDemo(side, my))) return;
      }
      strokeDemo?.destroy(); strokeDemo = null;
      el('zoomCard').hidden = true;
      if (await paintOverview(null, my) === false) return;
      replayBtn(true);
    },
    relayout: placeMarks,
  };
}

// ---------- 本人照片上的笔触（D43） ----------
// 照片在浏览器里的 blob 地址：只在本机，给示范和目标图的 SVG 用
function photoUrl() {
  if (!state.photoUrlPromise) {
    state.photoUrlPromise = new Promise((resolve) => {
      state.photo.canvas.toBlob((b) => resolve(URL.createObjectURL(b)), 'image/jpeg', 0.92);
    });
  }
  return state.photoUrlPromise;
}

// 两条眉各自的笔触规划（起笔收尾被拖动过就重算）；颜色取被拍者右眉区域最暗的 1% 像素
function ownSides() {
  const key = JSON.stringify(state.overrides);
  if (state.own?.key === key) return state.own;
  const ctx = state.photo.canvas.getContext('2d', { willReadFrequently: true });
  const sides = {};
  let color = 'rgb(90,70,60)';
  for (const side of ['left', 'right']) {
    const gs = sideOf(side);
    const roi = roiOf(gs, state.photo.W, state.photo.H);
    const img = ctx.getImageData(roi.x0, roi.y0, roi.w, roi.h);
    const r = analyzeRoi({ data: img.data, w: roi.w, h: roi.h, x0: roi.x0, y0: roi.y0 }, gs);
    sides[side] = { plan: r.plan, path: gs.path, halfThick: gs.bandHalf / 1.3, needs: r.needs };
    if (side === 'right') color = r.color;
  }
  if (DEV_SKIP === '0' || DEV_SKIP === '1') sides[state.sideOrder[+DEV_SKIP]].plan = [];
  // 记下目标标了哪几处（每条眉 5 项 + 笔数，不含照片和坐标），结果里和"同意吗"对照
  log.add('needs', { sides: state.sideOrder.map((side, n) => {
    const { needs, plan } = sides[side];
    return { label: SIDE_NAME[n], headLen: needs.headLen, headDen: needs.headDen, body: needs.body, tailLen: needs.tailLen, tailDen: needs.tailDen, strokes: plan.length };
  }) });
  state.own = { key, sides, color };
  return state.own;
}

async function ownScript(which, only = null) {
  return ownScriptFor({ which, only, side: demoSide(ownSides().sides) });
}

async function ownScriptFor(opts) {
  const own = ownSides();
  const href = await photoUrl();
  return buildOwnScript({ photo: { href, W: state.photo.W, H: state.photo.H }, sides: own.sides, color: own.color, ...opts });
}

// 练习（布局 D）：两条眉分开练，先镜子里右边；每边先示范、再停在这条眉的目标示意，去镜前画，"这边画好了"切到另一边
function renderPractice(s) {
  const st = C.steps[s.step];
  if (st.clip.kind !== 'own-photo') return renderDemo(s); // 旧的片段 / 朋友照片示范（审阅页用），流程里已不用
  shell({
    chip: stepChip(s),
    media: boardMedia(),
    body: '<p class="say" id="practiceSay"></p>',
    actions: `<button class="primary" data-act="practiceNext" id="practiceNext">${esc(C.ui.drawDone)}</button>
      <button class="secondary" data-act="boardReplay" id="replayBtn" hidden>${esc(C.ui.replayDemo)}</button>`,
  });
  board = mountBoard();
  board.startPractice();
}

// 最后自查（2026-10-11 Nicole 定）：检查的是镜子里实际画出的眉毛；手机上的总览只是目标示意和起笔收尾的参照
function renderCheck() {
  shell({
    chip: '最后自查',
    media: boardMedia(),
    body: `<p class="say">${esc(C.check.line)}</p>
      <ul class="checks">${C.check.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`,
    actions: `<button class="primary" data-act="next">${esc(C.ui.checkDone)}</button>
      <button class="secondary" data-act="boardReplay" id="replayBtn" hidden>${esc(C.ui.replayDemo)}</button>`,
  });
  board = mountBoard({ withTarget: true });
  board.startCheck();
}

function renderSurvey() {
  const S = C.survey;
  const opts = (type, name, list) => list.map((o) =>
    `<label class="opt"><input type="${type}" name="${name}" value="${esc(o)}"> ${esc(o)}</label>`).join('');
  shell({
    chip: C.ui.surveyChip, moment: '',
    body: `<form id="survey">
      <fieldset><legend>这对眉毛，你愿意就这样出门吗？</legend>${opts('radio', 'goOut', S.goOut)}</fieldset>
      <fieldset><legend>目标上标出的要补的地方，你同意吗？</legend>${opts('radio', 'targetAgree', S.targetAgree)}</fieldset>
      <fieldset id="targetWhere" hidden><legend>是哪条眉、哪一段？</legend>${opts('radio', 'targetSide', S.targetWhere.sides)}
        <div class="opt-row">${opts('checkbox', 'targetParts', S.targetWhere.parts)}</div></fieldset>
      <fieldset><legend>哪一部分最有帮助？</legend>${opts('radio', 'mostHelpful', S.mostHelpful)}</fieldset>
      <fieldset><legend>哪里最让你困惑？（可以不写）</legend><textarea name="confusing" maxlength="300"></textarea></fieldset>
      <fieldset><legend>你画眉时会遇到的这些问题，这次哪些有了答案？（可多选）</legend>${opts('checkbox', 'answered', S.answered)}</fieldset>
    </form>`,
    actions: '<button class="primary" data-act="finishSurvey">生成结果</button>',
    minor: 'back',
  });
  // 答了有问题才追问位置；改回"同意 / 看不出来"就收起
  document.getElementById('survey').addEventListener('change', (e) => {
    if (e.target.name !== 'targetAgree') return;
    document.getElementById('targetWhere').hidden = !S.targetProblems.includes(e.target.value);
  });
}

function finishSurvey() {
  const f = new FormData(document.getElementById('survey'));
  state.survey = {
    goOut: f.get('goOut') || '',
    targetAgree: f.get('targetAgree') || '',
    ...(C.survey.targetProblems.includes(f.get('targetAgree')) ? { targetSide: f.get('targetSide') || '', targetParts: f.getAll('targetParts') } : {}),
    mostHelpful: f.get('mostHelpful') || '',
    confusing: (f.get('confusing') || '').trim(),
    answered: f.getAll('answered'),
  };
  if (!log.events.some((e) => e.type === 'end')) log.add('end', { how: 'done' });
  state.endT = log.elapsed();
  next();
}

function renderSummary() {
  state.wantAwake = false;
  wakeLock?.release?.().catch(() => {});
  const text = summarize({
    events: log.events, endT: state.endT ?? log.elapsed(), labelOf,
    version: C.version, startedAt: fmtDate(startedAt), survey: state.survey,
  });
  shell({
    chip: '结果', minor: false,
    body: `<p class="say">谢谢你试用！</p>
      <p class="sub">下面是这次的文字结果，不含照片。愿意的话，复制后发给 ${esc(C.feedbackTo)}。</p>
      <pre class="result" id="result">${esc(text)}</pre>`,
    actions: '<button class="primary" data-act="copy">复制结果</button>',
  });
}

async function copyResult(btn) {
  const text = document.getElementById('result').textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '已复制，可以去粘贴了';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('result'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = '已选中文字，请长按复制';
  }
}

// ---------- ⓘ 说明：来源、理由、范围放这里，不占主画面（D43） ----------
function infoHtml(kind) {
  const p = (t) => `<p class="sub">${esc(t)}</p>`;
  if (kind === 'intro') {
    return [C.scope.situation ? `适用：${C.scope.situation}` : '', ...C.intro.info.map(fill)].filter(Boolean).map(p).join('');
  }
  return '';
}

function openInfo(btn) {
  modal.hidden = false;
  modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="说明">
    ${infoHtml(btn.dataset.info)}
    <div class="actions"><button class="secondary" data-act="infoClose">知道了</button></div></div>`;
  log.add('info', { id: screens[state.i].id });
}

// ---------- 卡住了 ----------
function openStuck() {
  const id = screens[state.i].id;
  modal.hidden = false;
  modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="卡住了">
    <p class="say">卡在哪里了？</p>
    <p class="sub">选一个最接近的。现在在：${esc(labelOf(id))}</p>
    <form id="stuckForm">
      ${C.stuckReasons.map((r, n) => `<label class="opt"><input type="radio" name="reason" value="${n}"> ${esc(r.text)}</label>`).join('')}
      <textarea name="note" placeholder="想多说一句也可以（选填）" maxlength="300"></textarea>
    </form>
    <div class="actions">
      <button class="primary" data-act="stuckContinue">记下了，我再试试</button>
      <button class="secondary" data-act="stuckEnd">到这里结束</button>
      <button class="text-btn" data-act="stuckCancel">没事，回去</button>
    </div></div>`;
}

function recordStuck() {
  const f = new FormData(document.getElementById('stuckForm'));
  const n = f.get('reason');
  const note = (f.get('note') || '').trim();
  if (n === null && !note) return false;
  const r = n === null ? { code: '', text: '（没选）' } : C.stuckReasons[Number(n)];
  log.add('stuck', { id: screens[state.i].id, code: r.code, reason: r.text, note });
  return true;
}

function closeModal() {
  modal.hidden = true;
  modal.innerHTML = '';
}

// ---------- 事件 ----------
const actions = {
  start: () => { state.wantAwake = true; keepAwake(); next(); },
  back,
  next,
  stuck: openStuck,
  openCamera,
  pickFile: () => document.getElementById('file').click(),
  devFace,
  shoot,
  flip,
  confirm: confirmPoints,
  replay: () => {
    if (strokeDemo) {
      strokeDemo.replay();
      log.add('replay', { step: screens[state.i].step });
      return;
    }
    const v = document.getElementById('clip');
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
    log.add('replay', { step: screens[state.i].step });
  },
  demoToggle: () => {
    if (!strokeDemo) return;
    if (strokeDemo.status === 'waiting' || strokeDemo.status === 'practice') {
      strokeDemo.replay();
      log.add('replay', { step: screens[state.i].step });
      return;
    }
    strokeDemo.toggle();
    log.add('demoPause', { step: screens[state.i].step, status: strokeDemo.status });
  },
  boardReplay: () => { // 原地重播示范（练习：当前这一边；自查：两边依次，播完收起）
    board?.replay();
    log.add('replay', { step: screens[state.i].step });
  },
  practiceNext: () => { if (!board?.advance()) next(); }, // "这边画好了"切到另一边；最后一边"画好了"进自查

  finishSurvey,
  copy: (btn) => copyResult(btn),
  stuckContinue: () => { recordStuck(); closeModal(); },
  stuckEnd: () => {
    recordStuck();
    const id = screens[state.i].id;
    log.add('end', { how: 'stuck', id });
    closeModal();
    go(indexOf(screens, 'survey'), 'jump');
  },
  stuckCancel: closeModal,
  info: (btn) => openInfo(btn),
  infoClose: closeModal,
};

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  actions[btn.dataset.act]?.(btn);
}
app.addEventListener('click', onClick);
modal.addEventListener('click', onClick);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (document.getElementById('view') && state.guide) render();
    board?.relayout();
  }, 150);
});

renderBanner();

// 旧应用（根目录）的 Service Worker 对同源请求缓存优先：若它接管了这个页面，改动会"不生效"（D41）。
// 只开 /follow/，不要在同一个端口打开根目录。
if (navigator.serviceWorker?.controller) {
  console.warn('[follow] 本页被 Service Worker 接管，可能读到旧文件：', navigator.serviceWorker.controller.scriptURL);
  if (DEV) {
    banner.hidden = false;
    banner.insertAdjacentHTML('beforeend', '<div><b>⚠️ 本页被旧的 Service Worker 接管，可能读到旧文件。请注销后重开。</b></div>');
  }
}

log.add('screen', { id: screens[0].id });
render();

// 开发用（正式链接不带 dev，不会触发）：
//   ?dev=1&at=s2-mirror-1           用合成脸直接跳到某一屏
//   ?dev=1&photo=.local/xxx.jpg     用本机的一张照片走真实识别；只接受同源路径，照片不离开这台电脑
//   两者可以同时用
const devParams = new URLSearchParams(location.search);
const jumpTo = DEV && devParams.get('at');
const devPhoto = DEV && devParams.get('photo');

function loadSameOriginPhoto(path) {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin) return Promise.reject(new Error('photo 参数只接受同源路径'));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => reject(new Error(`打不开 ${path}`));
    img.src = url.href;
  });
}

if (devPhoto || jumpTo) {
  const start = devPhoto
    ? loadSameOriginPhoto(devPhoto).then((c) => { go(indexOf(screens, 'capture'), 'jump'); return usePhoto(c, 'file'); })
    : devFace();
  start
    .then(() => { if (jumpTo && state.guide) go(indexOf(screens, jumpTo), 'jump'); })
    .catch((err) => console.error('[follow dev]', err));
}
