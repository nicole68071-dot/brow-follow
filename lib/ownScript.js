// D43 · 用本人照片和笔触规划，生成示范 / 目标图用的脚本（纯函数，不碰 DOM）。
// 脚本格式与 demo/script.js 相同，交给 lib/strokeDemo.js 播放、lib/strokeRender.js 画。
// 照片只在本机：photo.href 是浏览器里的 blob 地址。
import { analyzeBrow } from './sparseBrow.js';
import { planStrokesC, strokeGain, PLAN_DEFAULTS } from './strokePlan.js';
import { profileAlong, endNeeds, END_DEFAULTS } from './browEnds.js';

const LOREAL = 'https://www.lorealparis.ca/en-ca/how-to-shape-your-eyebrows-for-your-face-shape';
const ABH = 'https://www.anastasiabeverlyhills.com/products/brow-wiz';

// 与可行性测试第二轮冻结的 v1 参数相同（docs/d43-target-spike.md 第 9 节）
export const ANALYSIS = Object.freeze({ densityK: 1.2, textureK: 0.1, textureMin: 2, cells: 10, zones: 3, minCoherence: 0.3, interiorMargin: 0.2 });

const SOURCE = {
  head: `眉头的毛往上长（L'Oréal 加拿大站 Step 2 · ${LOREAL}）；斜竖由 Nicole 定`,
  body: `只补毛少的地方、顺着毛（L'Oréal Step 3 · ${LOREAL}；ABH · ${ABH}）`,
  tail: `一路补到眉尾（L'Oréal Step 3 · ${LOREAL}）`,
};
// 2026-10-11 Nicole 定：一组一句，整组固定显示；"短而轻"留在字幕里，力度很难只靠画面看懂
const SAY = { head: '眉头：往上斜画，短而轻', body: '眉身：顺着毛轻补空隙', tail: '眉尾：短笔补到收尾' };
const CONNECTION = { rule: '从眉头往眉尾，补下一处', source: `L'Oréal 加拿大站 Step 3 · ${LOREAL}` };

const unit = (a) => { const k = Math.hypot(a.x, a.y) || 1; return { x: a.x / k, y: a.y / k }; };
// 笔身从笔尖往上后方伸出去（比笔画方向再往上抬一点，免得盖住刚画出的颜色）
const bodyAxis = (d) => unit({ x: d.x, y: d.y - 0.35 });

// 眉带里最暗的 1% 像素的平均色（ABH：选接近自己眉毛的颜色）
export function darkestColor(rgba, frac = 0.01) {
  const px = [];
  for (let i = 0; i < rgba.length; i += 4) px.push([0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2], rgba[i], rgba[i + 1], rgba[i + 2]]);
  px.sort((a, b) => a[0] - b[0]);
  const n = Math.max(1, Math.round(px.length * frac));
  const avg = (k) => Math.round(px.slice(0, n).reduce((s, p) => s + p[k], 0) / n);
  return `rgb(${avg(1)},${avg(2)},${avg(3)})`;
}

// 一条眉：眉部区域（照片坐标里的一块 RGBA）→ 毛向（analyzeBrow）＋ 两端外延的绝对覆盖度剖面（browEnds）→ 5 件事 → 笔触规划
// 第 3 版（第 12 节）：只在判"要"的区下笔（planStrokesC）；一笔能补多少覆盖度 = 不透明度 × (皮肤 − 笔色)/(皮肤 − 眉色) × 一笔面积 ÷ 一格眉带面积。
// 笔的长度、粗细、不透明度与 buildOwnScript 的画法一致（长 1.2 × 眉带半宽，宽约为长的 7%→2%，不透明度 0.8）。
const lumaOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
// 眉带（离眉中线 ≤ 眉带半宽）里的像素，按 RGBA 排在一起
function bandRgba(data, w, h, { path, bandHalf }) {
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let d2 = Infinity;
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k]; const b = path[k + 1]; const vx = b.x - a.x; const vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)));
      d2 = Math.min(d2, (x - a.x - vx * t) ** 2 + (y - a.y - vy * t) ** 2);
    }
    if (d2 <= bandHalf * bandHalf) { const i = (y * w + x) * 4; out.push(data[i], data[i + 1], data[i + 2], data[i + 3]); }
  }
  return out.length ? Uint8ClampedArray.from(out) : data;
}
export function analyzeRoi({ data, w, h, x0, y0 }, gs) {
  const luma = new Float32Array(w * h);
  for (let i = 0; i < luma.length; i++) luma[i] = lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const A = ANALYSIS;
  const brow = { path: gs.path.map((p) => ({ x: p.x - x0, y: p.y - y0 })), bandHalf: gs.bandHalf };
  const r = analyzeBrow({ w, h, data: luma }, brow, {
    densityRadius: Math.round(gs.bandHalf * A.densityK),
    textureRadius: Math.max(A.textureMin, Math.round(gs.bandHalf * A.textureK)),
    cells: A.cells, zones: A.zones, minCoherence: A.minCoherence, interiorMargin: A.interiorMargin,
  });
  const prof = profileAlong({ w, h, data: luma }, brow);
  const needs = endNeeds(prof.bins, { fallbackFloor: prof.ringFloor });
  // 剖面每 1/perUnit 一格；合成 A.cells 格（眉长 0–1 那段）给笔触规划
  const z = Math.round(END_DEFAULTS.ext * END_DEFAULTS.perUnit); const per = END_DEFAULTS.perUnit / A.cells;
  const cells = r.cells.map((c, i) => {
    const part = prof.bins.slice(z + i * per, z + (i + 1) * per);
    const seen = part.filter((b) => b.c != null); // 落在照片外的格子没有数据
    return { cell: c.cell, u: c.u, dn: c.dn, c: seen.length ? seen.reduce((s, b) => s + b.c, 0) / seen.length : 0, dir: c.dir, coherence: c.coherence, shift: c.shift };
  });
  // 只取眉带（区域外延后会包进睫毛、发际线）；取最暗 5% 而不是 1%：1% 偏向阴影里的毛根，画出来太黑（2026-10-10 真机录屏）
  const color = darkestColor(bandRgba(data, w, h, brow), 0.05);
  const [cr, cg, cb] = color.match(/\d+/g).map(Number);
  const len = PLAN_DEFAULTS.lengthK * gs.bandHalf;
  const pathLen = gs.path.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.x - gs.path[k].x, p.y - gs.path[k].y), 0);
  const gain = strokeGain({
    opacity: 0.8, skinL: prof.skinL, strokeL: lumaOf(cr, cg, cb), strokeLen: len,
    strokeWidthMean: Math.max(1, 0.07 * len) / 1.7 + Math.max(0.3, 0.02 * len) / 2,
    cellLen: pathLen / A.cells, bandHalf: gs.bandHalf, maxDensity: Math.max(1, prof.skinL - prof.hairL), // 换算成覆盖度
  });
  return { cells, color, gain, needs, plan: planStrokesC({ path: gs.path, bandHalf: gs.bandHalf, cells, gain, needs }) };
}

// 眉部区域：左右外延 ext 倍眉长再加 2 个眉带半宽（剖面要测到起笔前、收尾后），上下 3 个眉带半宽（皮肤取 1.6–2.6 个半宽）
export function roiOf(gs, W, H) {
  const xs = gs.path.map((p) => p.x); const ys = gs.path.map((p) => p.y);
  const L = gs.path.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.x - gs.path[k].x, p.y - gs.path[k].y), 0);
  const padX = Math.ceil(END_DEFAULTS.ext * L + gs.bandHalf * 2); const padY = Math.ceil(gs.bandHalf * 3);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - padX));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - padY));
  return { x0, y0, w: Math.min(W, Math.ceil(Math.max(...xs) + padX)) - x0, h: Math.min(H, Math.ceil(Math.max(...ys) + padY)) - y0 };
}

// which = 'demo'（只画 side 这一条眉：每一类笔各一笔，再刷开）| 'target'（两条眉的全部笔 + 刷开后的样子）
// 方案 B：示范演示"每类笔怎么画"，不是把每一笔重放；目标图是重复画完、刷开之后的样子。
// 一笔都不用补时给出只有照片的画面（still: true，strokes 为空）——2026-10-10 真机录屏：原来返回 null，页面只剩黑底。
const FIRST_OF_EACH = (plan) => ['head', 'body', 'tail'].map((g) => plan.find((p) => p.group === g)).filter(Boolean);
// 示范只教一侧：默认被拍者右眉；右眉一笔都不用补、左眉要补时示范左眉（否则要补的人看不到示范）
export const demoSide = (sides) => (!sides.right.plan.length && sides.left.plan.length ? 'left' : 'right');

// 2026-10-11 Nicole 定（布局 D）：两条眉分开练——先镜子里右边、再镜子里左边，各自示范自己要补的内容；不用补的那条跳过，
// 用户不用自己选边。sideOrder = [镜子里左边那条, 镜子里右边那条]（app.js 按显示位置算）。
export const practiceSides = (sides, sideOrder) => [sideOrder[1], sideOrder[0]].filter((sd) => sides[sd].plan.length);

// 总览（布局 D，Nicole 2026-10-11）：双眉 + 眼睛上部 + 一点鼻梁，只用来认左右和起笔收尾；动作看下面的放大图。
// 左右各留平均眉长的 12%，上到眉上 1 个半宽，下到两个外眼角的平均高度（眼睛上半）。
export function overviewCrop(sides) {
  const L = ['left', 'right'];
  const pts = L.flatMap((sd) => sides[sd].path);
  const len = (p) => p.slice(1).reduce((s, b, i) => s + Math.hypot(b.x - p[i].x, b.y - p[i].y), 0);
  const pad = 0.12 * (len(sides.left.path) + len(sides.right.path)) / 2;
  const bh = (sides.left.bandHalf + sides.right.bandHalf) / 2;
  const x = Math.min(...pts.map((p) => p.x)) - pad;
  const y = Math.min(...pts.map((p) => p.y)) - bh;
  const bottom = (sides.left.eyeOuter.y + sides.right.eyeOuter.y) / 2;
  return { x, y, w: Math.max(...pts.map((p) => p.x)) + pad - x, h: bottom - y };
}

// only：目标图只画这一条眉（两条眉各一张图，眉毛显示得更大）
// groups：示范只取这几组（null = 这条眉要补的全部组）；blend：示范最后要不要刷开
export function buildOwnScript({ photo, sides, which, side = 'right', only = null, color, groups = null, blend = true }) {
  const order = which === 'demo' ? [side] : only ? [only] : ['right', 'left'];
  const strokes = [];
  for (const sd of order) {
    const demoStrokes = FIRST_OF_EACH(sides[sd].plan).filter((p) => !groups || groups.includes(p.group));
    for (const p of which === 'demo' ? demoStrokes : sides[sd].plan) {
      const start = { x: p.at.x - (p.dir.x * p.length) / 2, y: p.at.y - (p.dir.y * p.length) / 2 };
      strokes.push({
        start, dir: p.dir, length: p.length, weight: p.weight ?? 1, axis: bodyAxis(p.dir), group: p.group, brow: sd,
        say: SAY[p.group], source: SOURCE[p.group], ...(strokes.length ? { connection: CONNECTION } : {}),
      });
    }
  }
  // 取景：所有笔的两端 + 眉中线，外留一圈，补成 2:1
  const pts = [
    ...strokes.flatMap((st) => [st.start, { x: st.start.x + st.dir.x * st.length, y: st.start.y + st.dir.y * st.length }]),
    ...order.flatMap((sd) => sides[sd].path),
  ];
  const minX = Math.min(...pts.map((p) => p.x)); const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)); const maxY = Math.max(...pts.map((p) => p.y));
  const pad = 0.12 * Math.max(maxX - minX, maxY - minY);
  const w = Math.max(maxX - minX + 2 * pad, 2 * (maxY - minY + 2 * pad));
  const crop = { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - w / 4, w, h: w / 2 };
  const L = strokes[0]?.length || 10;
  const half = sides[order[0]].halfThick || L / 2;
  return {
    title: which === 'demo' ? '在你的眉上补' : '目标',
    scene: { image: { href: photo.href, width: photo.W, height: photo.H }, crop },
    scope: { brow: which === 'demo' ? side : only || 'both', hand: null },
    // 像一根毛：宽长比约 1:18，尾端收细；不透明度 0.6（原 0.8、宽 7%：2026-10-10 真机录屏里又深又粗，像贴上去的线，不是"轻补"）
    // blur：刷开后晕开的范围（示意参数，画面由 Nicole 判断）
    style: { color, widthStart: Math.max(1, L * 0.055), widthEnd: Math.max(0.3, L * 0.02), opacity: 0.6, blur: half * 0.5 },
    timing: { approach: 700, contact: 250, move: 450, lift: 300, travel: 500, blend: blend ? 1400 : 0, flick: L * 0.25, hover: L * 1.5 },
    stop: { rule: '从眉头补到眉尾就停', source: `L'Oréal 加拿大站 Step 3 · ${LOREAL}` },
    subtitles: {
      approach: '笔斜拿，找毛少处', contact: '笔尖轻轻放', move: '顺着毛画短短一笔',
      lift: '手腕一甩提起来', travel: '往眉尾找下一处',
      // 方案乙：示范播完，面板直接换成两条眉的目标示意，不再用字幕去引用还没出现的目标
      blend: '画完：用眉刷轻轻刷开', waiting: '',
    },
    strokes,
    ...(strokes.length ? {} : { still: true }),
  };
}



