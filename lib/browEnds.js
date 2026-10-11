// D43 第 12 节 · 两端（2026-10-10，方案 B 测试不通过之后）：每条眉判断 5 件事 ——
// 眉头要延长 / 要加密、眉身要补、眉尾要延长 / 要加密（纯函数，本机运行，不上传）。
//
// 第 11 节不通过的原因：浓度按"这条眉自己最浓的格"归一，又把眉形的宽度比例当成浓度目标 ⇒ 浓眉自然变淡的两端也被判"缺"。
// 这一版改为：
// 1. 绝对覆盖度：大窗口黑帽的平均 ÷ (皮肤亮度 − 眉色亮度)。约等于"眉带里有多大比例是毛"，不和这条眉自己比。
// 2. 沿眉中线两端各外延 ext 倍眉长一起测，才看得出眉毛实际从哪开始、到哪结束；收尾外那段当作皮肤底噪。
// 3. 长度和密度分开：末端连续 lenBins 格没有毛 = 没长到起笔 / 收尾点。已有的部分稀疏时只判"要加密"——
//    补笔会一直补到点，不另判延长（Nicole 在稀疏眉上也是这样标的）。
// 4. "要加密"的门槛分区：眉头 < 眉尾 < 眉身。顺序有出处（ABH：眉头轻画；眉尾自然收细），
//    数值是在开发集（D01–D03、S04–S06，Nicole 用三点三线标注页重标）上定的，见 docs/d43-target-spike.md 第 12 节。
import { blackHat } from './sparseBrow.js';

export const END_DEFAULTS = Object.freeze({
  ext: 0.3,        // 两端各外延 0.3 眉长
  perUnit: 20,     // 每格 0.05 眉长 ⇒ 一共 (1 + 2 × 0.3) × 20 = 32 格
  densityK: 1.2,   // 黑帽窗口半径 = 眉带半宽 × 1.2（同 ownScript.ANALYSIS）
  bareK: 2,        // 覆盖度 ≤ 皮肤底噪 × 2 ⇒ 这一格没有毛
  lenBins: 2,      // 末端连续 ≥ 2 格（0.1 眉长）没有毛 ⇒ 没长到点
  minBins: 2,      // 已有部分不到 2 格时，不判断它够不够密
  // "要加密"的门槛（绝对覆盖度）。在开发集上用这份代码定：取最接近的"要"和"不要"两条眉的中点（S06 左眉的"眉头要加密"除外）。
  head: 0.26,      //   眉头 0.05–0.2 的平均：要 ≤ 0.162，不要 ≥ 0.354
  body: 0.32,      //   眉身 0.2–0.7 里连续 3 格平均的最小值：要 ≤ 0.308，不要 ≥ 0.331 —— 只差 ±0.012，最脆弱
  tail: 0.28,      //   眉尾 0.7–0.9（只算已有的部分）的平均：要 ≤ 0.198，不要 ≥ 0.357
  headEnd: 0.2, bodyEnd: 0.7, tailDenEnd: 0.9,
  fillK: 1.4,              // 补笔补到门槛 × 1.4（笔数用，不参与判断）
  tipTaper: [1, 0.8, 0.5], // 眉尾 3 格（0.7–1）补到的浓度再按这个比例收细（笔数用，不参与判断）
});

function polyline(points) {
  const seg = []; let total = 0;
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k]; const b = points[k + 1]; const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > 0) { seg.push({ a, b, l, s0: total }); total += l; }
  }
  return { seg, total };
}

// 剖面：沿眉中线（两端外延）每 1/perUnit 眉长一格，返回每格的绝对覆盖度 c，以及皮肤、眉色亮度。
// 皮肤 = 离中线 1.6–2.6 个半宽那两条的亮度中位数；眉色 = 眉带里最暗 1% 的平均（都只取起笔到收尾那段）。
// 落在照片外、一个像素都没有的格子：c = null（2026-10-10：原来记 0，收尾拖到照片边缘时皮肤底噪变成 0）。
// ringFloor = 同一两条皮肤上黑帽的中位数 ÷ (皮肤 − 眉色)：收尾外没有数据时，用它当皮肤底噪。
export function profileAlong({ w, h, data }, { path, bandHalf }, opts = {}) {
  const P = { ...END_DEFAULTS, ...opts };
  const radius = P.densityRadius ?? Math.round(bandHalf * P.densityK);
  const L = polyline(path).total;
  const unit = (a, b) => { const l = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
  const t0 = unit(path[0], path[1]); const tn = unit(path[path.length - 2], path[path.length - 1]);
  const pre = P.ext * L;
  const { seg } = polyline([{ x: path[0].x - t0.x * pre, y: path[0].y - t0.y * pre }, ...path,
    { x: path.at(-1).x + tn.x * pre, y: path.at(-1).y + tn.y * pre }]);
  const B = Math.round(P.perUnit * (1 + 2 * P.ext));
  const dark = blackHat({ w, h, data }, radius);
  const acc = Array.from({ length: B }, () => ({ s: 0, n: 0 }));
  const skin = []; const band = []; const ringDark = [];
  const r2 = bandHalf * bandHalf; const ringLo = (1.6 * bandHalf) ** 2; const ringHi = (2.6 * bandHalf) ** 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let d2 = Infinity; let along = 0;
      for (const s of seg) {
        const vx = s.b.x - s.a.x; const vy = s.b.y - s.a.y;
        const k = Math.max(0, Math.min(1, ((x - s.a.x) * vx + (y - s.a.y) * vy) / (s.l * s.l)));
        const dd = (x - s.a.x - vx * k) ** 2 + (y - s.a.y - vy * k) ** 2;
        if (dd < d2) { d2 = dd; along = s.s0 + s.l * k; }
      }
      const i = y * w + x;
      const onBrow = along >= pre && along <= pre + L;
      if (onBrow && d2 >= ringLo && d2 <= ringHi) { skin.push(data[i]); ringDark.push(dark[i]); }
      if (d2 > r2) continue;
      if (onBrow) band.push(data[i]);
      const a = acc[Math.min(B - 1, Math.floor((along * P.perUnit) / L))];
      a.s += dark[i]; a.n += 1;
    }
  }
  skin.sort((a, b) => a - b); band.sort((a, b) => a - b); ringDark.sort((a, b) => a - b);
  const skinL = skin.length ? skin[Math.floor(skin.length / 2)] : 255;
  const nDark = Math.max(1, Math.round(band.length * 0.01));
  const hairL = band.length ? band.slice(0, nDark).reduce((s, v) => s + v, 0) / nDark : 0;
  const contrast = skinL - hairL > 1 ? skinL - hairL : 1;
  return {
    skinL, hairL,
    ringFloor: ringDark.length ? ringDark[Math.floor(ringDark.length / 2)] / contrast : 0,
    bins: acc.map((a, k) => ({ k, u: -P.ext + (k + 0.5) / P.perUnit, c: a.n ? a.s / a.n / contrast : null })),
  };
}

const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;

// 5 件事。全部按整数格计算（不用 u 的浮点比较）。没有数据（null）的格子不参与；
// 收尾外一格数据都没有时，皮肤底噪用 opts.fallbackFloor（profileAlong 的 ringFloor）。
export function endNeeds(bins, opts = {}) {
  const P = { ...END_DEFAULTS, ...opts };
  const z = Math.round(P.ext * P.perUnit);     // u = 0 那格
  const e = z + P.perUnit;                       // u = 1 之后的第一格
  const at = (u) => z + Math.round(u * P.perUnit);
  const outside = bins.slice(e + Math.round(0.1 * P.perUnit)).map((b) => b.c).filter((c) => c != null).sort((a, b) => a - b);
  const floor = outside.length ? outside[Math.floor(outside.length / 2)] : (P.fallbackFloor ?? 0);
  const hair = (k) => bins[k].c != null && bins[k].c > P.bareK * floor;
  let first = -1; let last = -1;
  for (let k = 0; k < e; k++) if (hair(k)) { if (first < 0) first = k; last = k; }
  const none = { headLen: false, headDen: false, body: false, tailLen: false, tailDen: false };
  if (first < 0) return { ...none, noBrow: true, floor, uStart: null, uEnd: null, stats: {} };

  const cs = (from, to) => bins.slice(from, to + 1).map((b) => b.c).filter((c) => c != null); // 含两端；没有数据的格子不算
  const head = cs(Math.max(z + 1, first), at(P.headEnd) - 1);
  const body = cs(at(P.headEnd), at(P.bodyEnd) - 1);
  const tail = cs(at(P.bodyEnd), Math.min(at(P.tailDenEnd) - 1, last));
  const ma3 = body.slice(2).map((_, i) => (body[i] + body[i + 1] + body[i + 2]) / 3);
  const stats = { head: head.length ? mean(head) : null, bodyMin: ma3.length ? Math.min(...ma3) : null, tail: tail.length ? mean(tail) : null };

  const headDen = head.length >= P.minBins && stats.head < P.head;
  const tailDen = tail.length >= P.minBins && stats.tail < P.tail;
  return {
    headLen: first - z >= P.lenBins && !headDen,
    headDen,
    body: stats.bodyMin != null && stats.bodyMin < P.body,
    tailLen: e - 1 - last >= P.lenBins && !tailDen,
    tailDen,
    noBrow: false, floor,
    uStart: (first - z) / P.perUnit, uEnd: (last + 1 - z) / P.perUnit,
    stats,
  };
}
