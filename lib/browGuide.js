// 眉妆跟练 v1 · 起笔 / 收尾定位（D41）
//
// 纯几何：不碰 DOM，不吃显示变换（D12 推论：derive*(realData, styleParams) -> sourceSpaceGeometry）。
// 输入输出都在 canonical_unmirrored 像素空间（原始拍摄画面，原点左上）。镜像统一交给显示层，
// 自拍和叠加层必须走同一个函数（src/mirror.js 的规则；follow/lib/mirror.js 是它的拷贝）。
//
// 定位规则（说法与来源在 follow/content.js 的 rules；来源核实前页面常驻"内容未就绪"）：
//   起笔 = 过鼻翼、沿面部竖直方向的直线，与眉中线的交点
//   收尾 = 鼻翼 → 外眼角连线的向外延长线，与眉中线（或其眉尾侧延长）的交点
// 面部竖直方向取两眼外角连线的垂线（D40 设计备注 2），头部轻微歪斜不会让竖线跑偏。
//
// ⚠️ MediaPipe 的眉毛关键点是人脸网格的回归结果，不是对眉毛"毛发"的检测。
// 所以这里只能说"按这条规则，起笔/收尾在这里"，不能说"你现有的眉毛到这里为止"。

export const BROW_GUIDE_LANDMARKS = {
  // left / right = 被拍者自己的左右（MediaPipe 约定），与 src/regions.js、src/motionTemplates.js 一致。
  // centerlinePairs 从眉头到眉尾排列（同 EYEBROW_MOTION）。
  // 绑定关系由 test/followGuide.test.js 断言，任一方改动必须同步。
  left: {
    centerlinePairs: [[285, 336], [295, 296], [282, 334], [283, 293], [276, 300]],
    noseWing: 278,
    eyeOuter: 263,
  },
  right: {
    centerlinePairs: [[55, 107], [65, 66], [52, 105], [53, 63], [46, 70]],
    noseWing: 48,
    eyeOuter: 33,
  },
};

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function px(landmarks, i, W, H) {
  const p = landmarks[i];
  if (!p) throw new Error(`缺少关键点 ${i}`);
  return { x: p.x * W, y: p.y * H };
}

// 面部坐标系：x 轴沿两眼外角连线（指向被拍者左侧），y 轴为其垂线（向下），原点在两眼外角中点。
export function faceFrame(landmarks, W, H) {
  const eL = px(landmarks, BROW_GUIDE_LANDMARKS.left.eyeOuter, W, H);
  const eR = px(landmarks, BROW_GUIDE_LANDMARKS.right.eyeOuter, W, H);
  const D = len(sub(eL, eR));
  const u = mul(sub(eL, eR), 1 / D);
  const v = { x: -u.y, y: u.x };
  const O = mid(eL, eR);
  return {
    D,
    toFace: (p) => { const d = sub(p, O); return { x: dot(d, u), y: dot(d, v) }; },
    fromFace: (q) => add(O, add(mul(u, q.x), mul(v, q.y))),
  };
}

// 两条直线求交：p + t·d = q + s·e。平行时返回 null。
function intersect(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(q, p);
  return { t: cross(w, e) / den, s: cross(w, d) / den };
}

// 起笔：面部坐标里 x = A 的竖线与眉中线（眉头 → 眉尾）的交点。
// 竖线落在中线范围外时，用靠近的那一段延长，并标记 extrapolated。
function startOnCenterline(center, A) {
  for (let k = 0; k < center.length - 1; k++) {
    const a = center[k];
    const b = center[k + 1];
    if (a.x !== b.x && (a.x - A) * (b.x - A) <= 0) {
      const r = (A - a.x) / (b.x - a.x);
      return { point: { x: A, y: a.y + r * (b.y - a.y) }, extrapolated: false };
    }
  }
  const n = center.length;
  const dir = Math.sign(center[n - 1].x - center[0].x) || 1;
  const beyondHead = (A - center[0].x) * dir < 0;
  const [a, b] = beyondHead ? [center[0], center[1]] : [center[n - 2], center[n - 1]];
  const r = (A - a.x) / (b.x - a.x);
  return { point: { x: A, y: a.y + r * (b.y - a.y) }, extrapolated: true };
}

// 收尾：鼻翼 → 外眼角连线（只取向外的一侧，t > 0）与眉中线的交点，取最靠眉尾的那个；
// 中线范围内没有交点时，与眉尾那一段的延长线求交，并标记 extended。
function endOnCenterline(center, noseWing, eyeOuter) {
  const d = sub(eyeOuter, noseWing);
  for (let k = center.length - 2; k >= 0; k--) {
    const hit = intersect(noseWing, d, center[k], sub(center[k + 1], center[k]));
    if (hit && hit.t > 0 && hit.s >= 0 && hit.s <= 1) {
      return { point: add(noseWing, mul(d, hit.t)), extended: false, fallback: false };
    }
  }
  const n = center.length;
  const hit = intersect(noseWing, d, center[n - 2], sub(center[n - 1], center[n - 2]));
  if (hit && hit.t > 0 && hit.s > 1) {
    return { point: add(noseWing, mul(d, hit.t)), extended: true, fallback: false };
  }
  // 几何上找不到合理交点（极少见）：先放在中线末端，交给用户拖动确认。
  return { point: center[n - 1], extended: false, fallback: true };
}

// 从起笔到收尾的路径：起点、两点之间的中线点、终点（面部坐标）。
function pathBetween(center, start, end) {
  const dir = Math.sign(end.x - start.x) || 1;
  const inner = center.filter((p) => (p.x - start.x) * dir > 0 && (end.x - p.x) * dir > 0);
  return [start, ...inner, end];
}

// overrides: { left?: { start?, end? }, right?: {...} }，canonical 像素坐标（用户拖动后的位置）。
export function computeBrowGuide(landmarks, W, H, overrides = {}) {
  const f = faceFrame(landmarks, W, H);
  const sides = {};
  for (const side of ['left', 'right']) {
    const cfg = BROW_GUIDE_LANDMARKS[side];
    const center = cfg.centerlinePairs.map(([i, j]) =>
      f.toFace(mid(px(landmarks, i, W, H), px(landmarks, j, W, H)))
    );
    const noseWing = px(landmarks, cfg.noseWing, W, H);
    const eyeOuter = px(landmarks, cfg.eyeOuter, W, H);
    const s = startOnCenterline(center, f.toFace(noseWing).x);
    const e = endOnCenterline(center, f.toFace(noseWing), f.toFace(eyeOuter));
    // 眉带半宽（D43 目标图可行性测试用）：眉毛上下关键点距离一半的中位数，放宽 1.3 倍容纳散开的毛
    const halves = cfg.centerlinePairs
      .map(([i, j]) => len(sub(px(landmarks, i, W, H), px(landmarks, j, W, H))) / 2)
      .sort((a, b) => a - b);
    const bandHalf = halves[Math.floor(halves.length / 2)] * 1.3;
    const ov = overrides[side] || {};
    const startF = ov.start ? f.toFace(ov.start) : s.point;
    const endF = ov.end ? f.toFace(ov.end) : e.point;
    sides[side] = {
      start: f.fromFace(startF),
      end: f.fromFace(endF),
      path: pathBetween(center, startF, endF).map(f.fromFace),
      auto: { start: f.fromFace(s.point), end: f.fromFace(e.point) },
      noseWing,
      eyeOuter,
      bandHalf,
      flags: { startExtrapolated: s.extrapolated, endExtended: e.extended, endFallback: e.fallback },
    };
  }
  return { eyeDistance: f.D, sides };
}

// 按弧长截取路径的 [f0, f1] 段（0 = 起笔，1 = 收尾）。
export function subPath(points, f0, f1) {
  const seg = [];
  let total = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const l = len(sub(points[k + 1], points[k]));
    seg.push(l);
    total += l;
  }
  const at = (f) => {
    let d = Math.min(1, Math.max(0, f)) * total;
    for (let k = 0; k < seg.length; k++) {
      if (d <= seg[k] || k === seg.length - 1) {
        const r = seg[k] ? Math.min(1, d / seg[k]) : 0;
        return { k, p: add(points[k], mul(sub(points[k + 1], points[k]), r)) };
      }
      d -= seg[k];
    }
    return { k: 0, p: points[0] };
  };
  const a = at(f0);
  const b = at(f1);
  return [a.p, ...points.slice(a.k + 1, b.k + 1), b.p];
}

export function pathLength(points) {
  let total = 0;
  for (let k = 0; k < points.length - 1; k++) total += len(sub(points[k + 1], points[k]));
  return total;
}

// 包住给定点的取景框：四周留 pad，再按 aspect（宽/高）补齐，保持居中。
export function viewRect(points, pad, aspect) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  let w = x1 - x0;
  let h = y1 - y0;
  if (w / h < aspect) {
    const nw = h * aspect; x0 -= (nw - w) / 2; w = nw;
  } else {
    const nh = w / aspect; y0 -= (nh - h) / 2; h = nh;
  }
  return { x: x0, y: y0, w, h };
}

// 确认页的三点三线（D43）：鼻翼 → 起笔、鼻翼 → 收尾、起笔 → 收尾的眉线。
// 一律连到"当前"的起笔和收尾（拖动后的位置），不能只动点、线还指着自动位置。
// 鼻翼是解剖参照，不跟着拖；拖离规则时，线会斜过去 —— 画面如实显示"这里已经不是按规则找的点了"。
export function referenceLines(s) {
  return { toStart: [s.noseWing, s.start], toEnd: [s.noseWing, s.end], brow: s.path };
}
