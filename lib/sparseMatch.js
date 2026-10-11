// D43 目标图可行性测试 · 比对规则（docs/d43-target-spike.md 第 5 节，预先登记，不随结果改）。
// 一处标注与算法给的某一处距离 ≤ 半径就算对上；一一配对，按距离从近到远贪心。

export function matchMarks(marks, zones, radius) {
  const cand = [];
  marks.forEach((m, i) => zones.forEach((zz, j) => {
    const d = Math.hypot(m.x - zz.center.x, m.y - zz.center.y);
    if (d <= radius) cand.push({ mark: i, zone: j, d });
  }));
  cand.sort((a, b) => a.d - b.d);
  const usedM = new Set(); const usedZ = new Set(); const pairs = [];
  for (const c of cand) {
    if (usedM.has(c.mark) || usedZ.has(c.zone)) continue;
    usedM.add(c.mark); usedZ.add(c.zone); pairs.push(c);
  }
  return { matched: pairs.length, pairs };
}

// 一条眉是否达标：半径 = 眉长 × k；至少对上 min(2, 标注数) 处，没有标注不算通过
export function judgeSide({ marks, zones, start, end, k }) {
  const browLen = Math.hypot(end.x - start.x, end.y - start.y);
  const radius = browLen * k;
  const required = Math.min(2, marks.length);
  const { matched, pairs } = matchMarks(marks, zones, radius);
  return { browLen, radius, required, matched, pairs, pass: marks.length > 0 && matched >= required };
}

// ---------- 第二轮（v1）：任务 = "这条眉只画三笔，画在哪"（Nicole 的标法：三笔都画在空隙最大的那一段） ----------
// 标注投影到"起笔 → 各格中心 → 收尾"折线上，按顶点的 u（沿眉长的比例）插值。
export function uOnBrow(pt, start, cells, end) {
  const verts = [{ p: start, u: 0 }, ...cells.map((c) => ({ p: c.mid, u: c.u })), { p: end, u: 1 }];
  let best = null;
  for (let k = 0; k < verts.length - 1; k++) {
    const a = verts[k].p; const b = verts[k + 1].p;
    const vx = b.x - a.x; const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
    const d = Math.hypot(pt.x - (a.x + vx * t), pt.y - (a.y + vy * t));
    if (!best || d < best.d) best = { d, u: verts[k].u + (verts[k + 1].u - verts[k].u) * t };
  }
  return best.u;
}

// 一条眉达标：她几笔的平均位置与算法三笔的平均位置，相差 ≤ k（眉长的比例）；没有标注不算
export function judgeSideV1({ marks, strokesU, start, cells, end, k }) {
  if (!marks.length) return { pass: false, diff: NaN, humanU: NaN, algoU: NaN };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const humanU = mean(marks.map((m) => uOnBrow(m, start, cells, end)));
  const algoU = mean(strokesU);
  const diff = Math.abs(humanU - algoU);
  return { pass: diff <= k, diff, humanU, algoU };
}
