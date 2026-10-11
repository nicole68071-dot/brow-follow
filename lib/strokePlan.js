// D43 目标图 · 每条眉画哪几笔（纯函数）。Nicole 2026-10-09 定的组成：
//   眉头：斜竖 3 笔（眉长前 15%）像扇子展开：最里面最竖（headInnerDeg），往外逐渐过渡到眉身读出的毛向 —— L'Oréal Step 2：眉头的毛往上长；
//         Nicole 2026-10-09：三笔不能全是一个角度
//   眉身：明显空隙 2 笔（中段 bodyRange 里存水最多的一段，按深度 1/4、3/4 分配；没有凹处就取中段最稀的一格）—— v1 空隙检测
//   眉尾：延长 2 笔（u = 0.88、0.96，往外补到收尾点）—— L'Oréal Step 3："一路补到眉尾"
// 方向：眉身、眉尾用读出的毛向（Nicole 判断过顺着毛）；读不出时借最近读得出的格，都读不出就顺着眉的走向。
// 位置、角度、长度都是按 Nicole 的描述定的示意参数，不是测量值；画面由她判断。
import { gapDepths } from './sparseBrow.js';

import { END_DEFAULTS } from './browEnds.js';
export const PLAN_DEFAULTS = Object.freeze({
  headU: [0.03, 0.08, 0.13],
  tailU: [0.88, 0.96],
  headInnerDeg: 80,     // 最里面一笔与眉走向的夹角
  fallbackBodyDeg: 20,  // 眉身毛向读不出时，扇形收到这个角度
  variation: 1,         // 每一笔的小变化：角度 ±5°、长度 ±12%、浓淡 0.75–1（0 = 不加变化，测试用）
  bodyRange: [0.2, 0.8],
  lengthK: 1.2,
  minCoherence: 0.3,
});

function geometry(path) {
  const seg = [];
  let total = 0;
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]; const b = path[k + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push({ a, b, l, s0: total });
    total += l;
  }
  return (u) => {
    const target = u * total;
    const s = seg.find((q, i) => target <= q.s0 + q.l || i === seg.length - 1);
    const k = s.l ? Math.max(0, Math.min(1, (target - s.s0) / s.l)) : 0;
    const t = { x: (s.b.x - s.a.x) / s.l, y: (s.b.y - s.a.y) / s.l };
    let n = { x: -t.y, y: t.x };
    if (n.y > 0) n = { x: -n.x, y: -n.y }; // 朝上
    return { p: { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k }, t, n };
  };
}

export function planStrokes({ path, bandHalf, cells }, opts = {}) {
  const P = { ...PLAN_DEFAULTS, ...opts };
  const at = geometry(path);
  const N = cells.length;
  const length = P.lengthK * bandHalf;
  const cellOf = (u) => Math.min(N - 1, Math.max(0, Math.floor(u * N)));
  const readDir = (u) => {
    const ci = cellOf(u);
    const ok = cells.filter((c) => c.coherence >= P.minCoherence);
    if (cells[ci].coherence >= P.minCoherence) return cells[ci].dir;
    if (!ok.length) return at(u).t;
    return ok.sort((a, b) => Math.abs(a.cell - ci) - Math.abs(b.cell - ci))[0].dir;
  };
  const mk = (group, u, dir, basis) => ({ group, u, at: at(u).p, dir, length, basis });

  // 眉头扇形：从 headInnerDeg 逐步过渡到眉身起点读出的毛向（相对眉走向的夹角，朝上为正）
  const bodyStart = P.bodyRange[0] + 0.05;
  const coherentBody = cells[cellOf(bodyStart)].coherence >= P.minCoherence || cells.some((c) => c.coherence >= P.minCoherence);
  let bodyDeg = P.fallbackBodyDeg;
  if (coherentBody) {
    const d = readDir(bodyStart); const { t, n } = at(bodyStart);
    bodyDeg = (Math.atan2(d.x * n.x + d.y * n.y, d.x * t.x + d.y * t.y) * 180) / Math.PI;
  }
  const head = P.headU.map((u, i) => {
    const deg = P.headInnerDeg - ((P.headInnerDeg - bodyDeg) * i) / P.headU.length;
    const a = (deg * Math.PI) / 180; const { t, n } = at(u);
    return mk('head', u, { x: Math.cos(a) * t.x + Math.sin(a) * n.x, y: Math.cos(a) * t.y + Math.sin(a) * n.y }, 'head-fan');
  });

  // 眉身：只在中段里找凹处
  const inBody = (i) => { const u = (i + 0.5) / N; return u >= P.bodyRange[0] && u <= P.bodyRange[1]; };
  const depth = gapDepths(cells.map((c) => c.dn)).map((d, i) => (inBody(i) ? d : 0));
  let best = null; let run = null;
  for (let i = 0; i <= N; i++) {
    if (i < N && depth[i] > 0) { run = run || { cells: [], total: 0 }; run.cells.push(i); run.total += depth[i]; }
    else if (run) { if (!best || run.total > best.total) best = run; run = null; }
  }
  let bodyCells; let weights; let basis;
  if (best) { bodyCells = best.cells; weights = best.cells.map((i) => depth[i]); basis = 'gap'; }
  else {
    let pick = -1;
    for (let i = 0; i < N; i++) if (inBody(i) && (pick < 0 || cells[i].dn < cells[pick].dn)) pick = i;
    bodyCells = [pick]; weights = [1]; basis = 'lowest-interior';
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const uAt = (q) => {
    let need = q * total;
    for (let k = 0; k < bodyCells.length; k++) {
      if (need <= weights[k] || k === bodyCells.length - 1) return (bodyCells[k] + Math.min(1, need / weights[k])) / N;
      need -= weights[k];
    }
    return (bodyCells[0] + 0.5) / N;
  };
  const body = [0.25, 0.75].map((q) => { const u = uAt(q); return mk('body', u, readDir(u), basis); });

  const tail = P.tailU.map((u) => mk('tail', u, readDir(u), 'tail-extend'));
  // 每一笔的小变化（可重复：按笔的序号取伪随机数），让一组笔不像复制出来的
  const rnd = (k) => { const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  return [...head, ...body, ...tail].sort((a, b) => a.u - b.u).map((s, k) => {
    const v = P.variation;
    const da = (((2 * rnd(3 * k) - 1) * 5) * Math.PI) / 180 * v;
    const dir = { x: s.dir.x * Math.cos(da) - s.dir.y * Math.sin(da), y: s.dir.x * Math.sin(da) + s.dir.y * Math.cos(da) };
    return { ...s, dir, length: s.length * (1 + (2 * rnd(3 * k + 1) - 1) * 0.12 * v), weight: 1 - rnd(3 * k + 2) * 0.25 * v };
  });
}

// 目标眉形（D43 妆效预览）：沿眉中线两侧各一条边。粗细 = 半厚 × 形状比例。
// 半厚来自人脸关键点间距的估计（browGuide 的 bandHalf / 1.3），不是测出来的毛发边界；
// 形状比例是模板：眉头从 0.75 渐宽到 1（前 12%），眉身 1，眉尾从 70% 起收到 0.3。
// 准确说法：以本人眉部几何和确认后的起笔、收尾为基础，生成目标示意，不另推荐眉形。叠出来的轮廓是否适合真实眉毛，待观察。
export function targetBrowShape({ path, halfThick }, { samples = 41 } = {}) {
  const at = geometry(path);
  const profile = shapeProfile;
  const upper = []; const lower = [];
  for (let k = 0; k < samples; k++) {
    const u = k / (samples - 1);
    const { p, n } = at(u);
    const w = halfThick * profile(u);
    upper.push({ x: p.x + n.x * w, y: p.y + n.y * w });
    lower.push({ x: p.x - n.x * w, y: p.y - n.y * w });
  }
  return { upper, lower, points: [...upper, ...[...lower].reverse()] };
}

// 形状比例：眉头从 0.75 渐宽到 1（前 12%），眉身 1，眉尾从 70% 起收到 0.3。目标眉形和目标浓度共用这一套模板。
export function shapeProfile(u) {
  return u < 0.12 ? 0.75 + 0.25 * (u / 0.12) : u > 0.7 ? 1 - 0.7 * ((u - 0.7) / 0.3) : 1;
}

// ---------- 方案 B（2026-10-10 Nicole 定）：笔数按"补到目标浓度"算 ----------
// 一笔能把一格的相对浓度补多少：不透明度 × (皮肤亮度 − 笔色亮度) × 一笔面积 ÷ (一格眉带面积 × 这条眉最浓那格的绝对暗度)
export function strokeGain({ opacity, skinL, strokeL, strokeLen, strokeWidthMean, cellLen, bandHalf, maxDensity }) {
  return (opacity * (skinL - strokeL) * strokeLen * strokeWidthMean) / (cellLen * 2 * bandHalf * maxDensity);
}

// 上限 2026-10-10 在 D01–D03 运行前改：每格 3→5、每条眉 15→40（S01 上 15 笔补不到目标浓度；实际补一条眉常要几十笔）
export const PLAN_B_DEFAULTS = Object.freeze({ level: 0.9, minDeficit: 0.1, capCell: 5, capBrow: 40, headEnd: 0.2, bodyEnd: 0.7 });

// 每一区"要不要补"（会不会引导多画的测试用）：这一区有没有缺口 ≥ minDeficit 的格。和笔数上限无关。
export function regionNeeds(cells, opts = {}) {
  const P = { ...PLAN_B_DEFAULTS, ...opts };
  const N = cells.length;
  const out = { head: false, body: false, tail: false };
  cells.forEach((c, i) => {
    const u = (i + 0.5) / N;
    if (P.level * shapeProfile(u) - c.dn < P.minDeficit) return;
    out[u < P.headEnd ? 'head' : u <= P.bodyEnd ? 'body' : 'tail'] = true;
  });
  return out;
}

// 目标浓度 T(u) = level × 形状比例(u)；缺口 = max(0, T − 相对浓度)；缺口 < minDeficit 不画；一格 ⌈缺口 ÷ gain⌉ 笔（最多 capCell），
// 一条眉最多 capBrow 笔（先保留缺口大的格）。浓眉每格都不低于目标 ⇒ 一笔不画。
// 方向：眉头（u < headEnd）的笔排成扇形（headInnerDeg 起过渡到眉身读出的毛向）；其余用读出的毛向（借邻格 / 沿眉走向）。
export function planStrokesB({ path, bandHalf, cells, gain }, opts = {}) {
  const P = { ...PLAN_DEFAULTS, ...PLAN_B_DEFAULTS, ...opts };
  const N = cells.length;
  const need = cells.map((c, i) => {
    const deficit = Math.max(0, P.level * shapeProfile((i + 0.5) / N) - c.dn);
    // 减 1e-9 再取整：0.3/0.15 在浮点里是 2.0000000000000004，不能因此多算一笔
    return { i, deficit, n: deficit < P.minDeficit ? 0 : Math.min(P.capCell, Math.ceil(deficit / gain - 1e-9)) };
  });
  return placeStrokes({ path, bandHalf, cells, need }, P);
}

// 第 3 版（第 12 节，2026-10-10）：只在 endNeeds 判"要"的区下笔，补到绝对覆盖度的目标（门槛 × fillK，眉尾末 3 格再按 tipTaper 收细）。
// 眉头 / 眉尾只判"要延长"时，只在没长到的那段（起笔到毛开始处 / 毛结束处到收尾）下笔。一个区都不用 ⇒ 一笔不画。
// cells 的 c = 绝对覆盖度（lib/browEnds.js 的剖面每两格合成一格）。
export const PLAN_C_DEFAULTS = Object.freeze({ minDeficit: 0.05, capCell: 5, capBrow: 40, maxDeg: 40,
  jitter: Object.freeze({ deg: 10, len: 0.2, weight: 0.4, slot: 0.3 }) });
export function planStrokesC({ path, bandHalf, cells, gain, needs }, opts = {}) {
  const E = { ...END_DEFAULTS, ...opts };
  const P = { ...PLAN_DEFAULTS, ...PLAN_B_DEFAULTS, ...PLAN_C_DEFAULTS, ...opts };
  const N = cells.length;
  const tailFrom = Math.round(E.bodyEnd * N);
  const target = (i) => {
    const u = (i + 0.5) / N;
    if (u < E.headEnd) return E.head * E.fillK;
    if (u < E.bodyEnd) return E.body * E.fillK;
    return E.tail * E.fillK * (E.tipTaper[i - tailFrom] ?? E.tipTaper.at(-1));
  };
  // 按整数比较（needs.uStart / uEnd 是 1/perUnit 的整数倍）：格 i 覆盖 [i/N, (i+1)/N)
  const k = (u) => Math.round(u * N * E.perUnit) / E.perUnit; // u × N，去掉浮点尾数
  const allow = (i) => {
    const u = (i + 0.5) / N;
    if (u < E.headEnd) return needs.headDen || (needs.headLen && i < k(needs.uStart));
    if (u < E.bodyEnd) return needs.body;
    return needs.tailDen || (needs.tailLen && i + 1 > k(needs.uEnd));
  };
  const need = cells.map((c, i) => {
    const deficit = allow(i) ? Math.max(0, target(i) - c.c) : 0;
    return { i, deficit, n: deficit < P.minDeficit ? 0 : Math.min(P.capCell, Math.ceil(deficit / gain - 1e-9)) };
  });

  // 2026-10-10 真机录屏"示范错误"三处：
  // ①方向：没毛的格子（覆盖度 ≤ 底噪 × bareK，和判断"没长到点"同一个标准）读到的是皮肤纹理 ⇒ 不用，借最近有毛的格子；
  //   眉身、眉尾的笔和眉走向最多差 maxDeg（护栏，无出处）。
  // ②位置：笔围绕每格毛的中心（cells[i].shift）放；没毛的格子借最近有毛格子的，再和左右相邻格平均，不让位置跳；限制在 ±半厚 里。
  // ③变化更大：角度 ±10°、长度 ±20%、浓淡 0.6–1、沿眉位置 ±0.3 个间距 —— 不再整齐平行（示意参数，画面由 Nicole 判断）。
  const hair = (c) => c.c > E.bareK * (needs.floor ?? 0);
  const halfThick = bandHalf / 1.3;
  const hairy = cells.filter(hair);
  const own = cells.map((c) => (hair(c) || !hairy.length ? c.shift ?? 0
    : [...hairy].sort((a, b) => Math.abs(a.cell - c.cell) - Math.abs(b.cell - c.cell))[0].shift ?? 0));
  const shift = own.map((_, i) => {
    const near = own.slice(Math.max(0, i - 1), i + 2);
    return Math.max(-halfThick, Math.min(halfThick, near.reduce((a, b) => a + b, 0) / near.length));
  });
  const cellOf = (u) => Math.min(N - 1, Math.max(0, Math.floor(u * N)));
  return placeStrokes({ path, bandHalf, cells, need }, P, {
    trust: (c) => c.coherence >= P.minCoherence && hair(c),
    maxDeg: P.maxDeg,
    shiftAt: (u) => shift[cellOf(u)],
    jitter: P.jitter,
  });
}

// 共用：每格 need[i].n 笔 ⇒ 位置、方向、长度、浓淡。一条眉最多 capBrow 笔（先保留缺口大的格）。
// look（第 3 版传入，方案 B 用默认值、结果不变）：
//   trust(cell)：这一格读出的方向能不能用；不能用就借最近一格能用的。
//   maxDeg：眉身、眉尾的笔和眉走向最多差多少度（null = 不限）。
//   shiftAt(u)：笔的中心离中线多远（像素，朝上为正）。
//   jitter：随机变化的幅度 —— 角度（度）、长度（比例）、浓淡（比例）、沿眉位置（占一笔间距的比例）。
const LOOK_B = { maxDeg: null, shiftAt: () => 0, jitter: { deg: 5, len: 0.12, weight: 0.25, slot: 0 } };
function placeStrokes({ path, bandHalf, cells, need }, P, look = {}) {
  const L = { ...LOOK_B, trust: (c) => c.coherence >= P.minCoherence, ...look };
  const at = geometry(path);
  const N = cells.length;
  const length = P.lengthK * bandHalf;
  const cellOf = (u) => Math.min(N - 1, Math.max(0, Math.floor(u * N)));
  const ok = cells.filter(L.trust);
  const readDir = (u) => {
    const ci = cellOf(u);
    if (L.trust(cells[ci])) return cells[ci].dir;
    if (!ok.length) return at(u).t;
    return [...ok].sort((a, b) => Math.abs(a.cell - ci) - Math.abs(b.cell - ci))[0].dir;
  };
  let budget = P.capBrow;
  for (const c of [...need].sort((a, b) => b.deficit - a.deficit)) { c.n = Math.min(c.n, budget); budget -= c.n; }

  // 同一格的几笔：沿眉均匀分开，并在眉的厚度方向上错开（0、+0.45、−0.45、+0.22、−0.22 个"半厚 × 形状比例"），
  // 不排成一行梳齿，也不超出目标眉形（半厚 = 眉带半宽 / 1.3，同 targetBrowShape）
  const OFFS = [0, 0.45, -0.45, 0.22, -0.22];
  const halfThick = bandHalf / 1.3;
  const raw = [];
  for (const c of need) for (let k = 0; k < c.n; k++) raw.push({ u: (c.i + (k + 0.5) / c.n) / N, off: OFFS[k % OFFS.length], gap: 1 / (N * c.n) });
  const group = (u) => (u < P.headEnd ? 'head' : u <= P.bodyEnd ? 'body' : 'tail');

  // 眉头扇形
  const bodyStart = P.headEnd + 0.05;
  let bodyDeg = P.fallbackBodyDeg;
  if (ok.length) {
    const d = readDir(bodyStart); const { t, n } = at(bodyStart);
    bodyDeg = (Math.atan2(d.x * n.x + d.y * n.y, d.x * t.x + d.y * t.y) * 180) / Math.PI;
  }
  const heads = raw.filter((r) => group(r.u) === 'head');
  const rnd = (k) => { const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const turn = (t, n, deg) => { const a = (deg * Math.PI) / 180; return { x: Math.cos(a) * t.x + Math.sin(a) * n.x, y: Math.cos(a) * t.y + Math.sin(a) * n.y }; };
  const v = P.variation; const J = L.jitter;
  return raw.map((r, k) => {
    const g = group(r.u);
    const u = Math.min(1, Math.max(0, r.u + (2 * rnd(1000 + k) - 1) * J.slot * r.gap * v));
    const base = at(u);
    const w = L.shiftAt(u) + r.off * halfThick * shapeProfile(u);
    let dir;
    if (g === 'head') {
      const h = heads.indexOf(r);
      dir = turn(base.t, base.n, P.headInnerDeg - ((P.headInnerDeg - bodyDeg) * h) / heads.length);
    } else {
      dir = readDir(u);
      if (L.maxDeg != null) { // 护栏：读到的方向离眉走向太远，多半是皮肤纹理或眉毛轮廓，不是毛
        const deg = (Math.atan2(dir.x * base.n.x + dir.y * base.n.y, dir.x * base.t.x + dir.y * base.t.y) * 180) / Math.PI;
        if (Math.abs(deg) > L.maxDeg) dir = turn(base.t, base.n, Math.sign(deg) * L.maxDeg);
      }
    }
    const da = (((2 * rnd(3 * k) - 1) * J.deg) * Math.PI) / 180 * v;
    return {
      group: g, u, at: { x: base.p.x + base.n.x * w, y: base.p.y + base.n.y * w }, basis: 'deficit',
      dir: { x: dir.x * Math.cos(da) - dir.y * Math.sin(da), y: dir.x * Math.sin(da) + dir.y * Math.cos(da) },
      length: length * (1 + (2 * rnd(3 * k + 1) - 1) * J.len * v),
      weight: 1 - rnd(3 * k + 2) * J.weight * v,
    };
  });
}
