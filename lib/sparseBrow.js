// D43 目标图可行性测试 · 在一张眉部照片里找"毛少的地方"和"毛的方向"（纯函数，本机运行，不上传）。
//
// 输入：灰度图（只取眉部附近一块）＋ 眉中线（起笔 → 收尾）＋ 眉带半宽。
// 1. 黑帽变换：闭运算（先取窗口最大、再取最小）抹掉比窗口细的深色结构，再减去原图。
//    · 密度用大窗口（densityRadius 比眉带宽）：闭运算估出周围皮肤的颜色，黑帽 = 这里比皮肤暗多少；毛密的地方也测得准。
//      （小窗口在毛密处找不到皮肤，会把整片眉毛当成背景 —— 合成图上测出来的问题。）比眉带还宽的阴影会被当成背景去掉。
//    · 方向用小窗口（textureRadius）：只留下细毛的纹理，再用它加权算结构张量。
// 2. 沿中线按弧长分成 cells 格；每格在眉带里统计平均暗度（分上半、下半）和结构张量。
// 3. 毛少 = 这一格的平均毛强度相对全眉最多的那格低；取最低的几格，彼此不相邻；落点放在更稀的那一半。
// 4. 方向 = 结构张量主方向的垂直方向（毛的走向），一致性低的格子借最近一个方向清楚的格子；方向统一朝收尾。
//
// ⚠️ 合成图上的测试只说明"实现对不对"；真照片上行不行，由 docs/d43-target-spike.md 里预先定好的标准判断。

function minMax1D(src, w, h, r, horizontal, pick) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      for (let k = -r; k <= r; k++) {
        const xx = horizontal ? x + k : x;
        const yy = horizontal ? y : y + k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        v = pick(v, src[yy * w + xx]);
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

export function blackHat({ w, h, data }, r) {
  const dil = minMax1D(minMax1D(data, w, h, r, true, Math.max), w, h, r, false, Math.max);
  const clo = minMax1D(minMax1D(dil, w, h, r, true, Math.min), w, h, r, false, Math.min);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.max(0, clo[i] - data[i]);
  return out;
}

function pathGeometry(path) {
  const seg = [];
  let total = 0;
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]; const b = path[k + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push({ a, b, l, s0: total });
    total += l;
  }
  return { seg, total };
}

// 像素在中线上的投影：弧长比例 u、带符号距离 d（> 0 = 眉的上半，图像里朝上的一侧）
function project(geo, x, y) {
  let best = null;
  for (const s of geo.seg) {
    const vx = s.b.x - s.a.x; const vy = s.b.y - s.a.y;
    const k = Math.max(0, Math.min(1, ((x - s.a.x) * vx + (y - s.a.y) * vy) / (s.l * s.l || 1)));
    const px = s.a.x + vx * k; const py = s.a.y + vy * k;
    const dist2 = (x - px) ** 2 + (y - py) ** 2;
    if (!best || dist2 < best.dist2) {
      let nx = -vy / s.l; let ny = vx / s.l;
      if (ny > 0) { nx = -nx; ny = -ny; } // 法向朝上
      best = { dist2, u: (s.s0 + s.l * k) / geo.total, d: (x - px) * nx + (y - py) * ny, t: { x: vx / s.l, y: vy / s.l }, n: { x: nx, y: ny } };
    }
  }
  return best;
}

function pointAt(geo, u) {
  const target = u * geo.total;
  for (const s of geo.seg) {
    if (target <= s.s0 + s.l || s === geo.seg[geo.seg.length - 1]) {
      const k = s.l ? Math.max(0, Math.min(1, (target - s.s0) / s.l)) : 0;
      const t = { x: (s.b.x - s.a.x) / s.l, y: (s.b.y - s.a.y) / s.l };
      let n = { x: -t.y, y: t.x };
      if (n.y > 0) n = { x: -n.x, y: -n.y };
      return { p: { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k }, t, n };
    }
  }
  return null;
}

// tensorBandK：只用眉带中间这一段（|d| ≤ 半宽 × tensorBandK）算方向，避开眉毛上下边缘 —— 边缘的走向是眉形，不是毛。
export function analyzeBrow(img, brow, { densityRadius, textureRadius, cells: N, zones: K, minCoherence, tensorBandK = 1, interiorMargin = 0.2 }) {
  const { w, h, data } = img;
  const dark = blackHat(img, densityRadius);
  const hair = blackHat(img, textureRadius);
  const geo = pathGeometry(brow.path);
  const acc = Array.from({ length: N }, () => ({ sum: 0, n: 0, sd: 0, up: 0, nUp: 0, lo: 0, nLo: 0, jxx: 0, jxy: 0, jyy: 0 }));

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const pr = project(geo, x, y);
      if (pr.u < 0 || pr.u > 1 || Math.abs(pr.d) > brow.bandHalf) continue;
      const c = acc[Math.min(N - 1, Math.floor(pr.u * N))];
      const i = y * w + x;
      const v = dark[i];
      c.sum += v; c.n += 1; c.sd += v * pr.d;
      if (pr.d > 0) { c.up += v; c.nUp += 1; } else { c.lo += v; c.nLo += 1; }
      const wt = Math.abs(pr.d) <= brow.bandHalf * tensorBandK ? hair[i] : 0;
      const gx = (data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1]) - (data[i - w - 1] + 2 * data[i - 1] + data[i + w - 1]);
      const gy = (data[i + w - 1] + 2 * data[i + w] + data[i + w + 1]) - (data[i - w - 1] + 2 * data[i - w] + data[i - w + 1]);
      c.jxx += wt * gx * gx; c.jxy += wt * gx * gy; c.jyy += wt * gy * gy;
    }
  }

  const dens = acc.map((c) => (c.n ? c.sum / c.n : 0));
  const maxD = Math.max(...dens) || 1;
  const cells = acc.map((c, i) => {
    const mid = pointAt(geo, (i + 0.5) / N);
    const theta = 0.5 * Math.atan2(2 * c.jxy, c.jxx - c.jyy); // 梯度主方向
    let dir = { x: -Math.sin(theta), y: Math.cos(theta) };     // 毛的走向 = 梯度的垂直方向
    if (dir.x * mid.t.x + dir.y * mid.t.y < 0) dir = { x: -dir.x, y: -dir.y }; // 朝收尾
    const tr = c.jxx + c.jyy;
    const coherence = tr > 0 ? Math.hypot(c.jxx - c.jyy, 2 * c.jxy) / tr : 0;
    return {
      cell: i, u: (i + 0.5) / N, density: dens[i], dn: dens[i] / maxD, score: 1 - dens[i] / maxD,
      // 毛的中心离中线多远（像素，朝上为正）：暗度加权的平均带符号距离。2026-10-10 真机录屏：关键点中线在眉头眉身偏上、眉尾偏下
      shift: c.sum > 0 ? c.sd / c.sum : 0,
      upper: c.nUp ? c.up / c.nUp : 0, lower: c.nLo ? c.lo / c.nLo : 0, dir, coherence, mid,
    };
  });

  const picked = [];
  for (const c of [...cells].sort((a, b) => b.score - a.score)) {
    if (picked.length >= K) break;
    if (picked.every((p) => Math.abs(p.cell - c.cell) >= 2)) picked.push(c);
  }
  const zones = picked.map((c) => {
    const side = c.upper < c.lower ? 'upper' : 'lower';
    const off = (side === 'upper' ? 1 : -1) * (brow.bandHalf / 2);
    const own = c.coherence >= minCoherence;
    const src = own ? c : cells
      .filter((o) => o.coherence >= minCoherence)
      .sort((a, b) => Math.abs(a.cell - c.cell) - Math.abs(b.cell - c.cell))[0] || c;
    return {
      cell: c.cell, u: c.u, side, score: c.score,
      center: { x: c.mid.p.x + c.mid.n.x * off, y: c.mid.p.y + c.mid.n.y * off },
      dir: src.dir, dirFrom: src.cell,
    };
  });
  // v1：三笔放在最大空隙那一段，按空隙深度分配 —— 深度累计到 1/6、1/2、5/6 处（越空的地方笔越多；
  // 段尾零点几的浅噪声几乎分不到笔）。没有凹处时（退路那一格）在格内均匀分开。落在眉中线上；方向取最近一个方向清楚的格子。
  const dn = cells.map((c) => c.dn);
  const gap = biggestGap(dn, { interiorMargin });
  const depth = gapDepths(dn);
  const weights = gap.cells.map((ci) => (gap.kind === 'gap' ? depth[ci] : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const uAtQuantile = (q) => {
    let need = q * total;
    for (let k = 0; k < gap.cells.length; k++) {
      if (need <= weights[k] || k === gap.cells.length - 1) return (gap.cells[k] + Math.min(1, need / weights[k])) / N;
      need -= weights[k];
    }
    return (gap.cells[0] + 0.5) / N;
  };
  const dirAt = (ci) => {
    const own = cells[ci];
    if (own.coherence >= minCoherence) return { dir: own.dir, from: ci };
    const src = cells.filter((o) => o.coherence >= minCoherence)
      .sort((a, b) => Math.abs(a.cell - ci) - Math.abs(b.cell - ci))[0] || own;
    return { dir: src.dir, from: src.cell };
  };
  const strokes = [1, 3, 5].map((k) => {
    const u = uAtQuantile(k / 6);
    const ci = Math.min(N - 1, Math.floor(u * N));
    const { dir, from } = dirAt(ci);
    return { u, at: pointAt(geo, u).p, dir, dirFrom: from };
  });
  return { cells, zones, gap, strokes };
}

// ---------- v1（D43 第二轮）：空隙 = 两边有毛、中间凹下去的地方 ----------
// Nicole：只有三笔时，她把三笔都画在"空隙最大的那一段"；眉头眉尾逐渐变淡，也要画，但不是空隙。
// 每格空隙深度 = min(左侧最高, 右侧最高) − 这一格（凹槽里能存的水）。两端是斜坡，存不住水，不需要任意的渐变参数。
export function gapDepths(cov) {
  const n = cov.length;
  const left = new Array(n).fill(-Infinity);
  const right = new Array(n).fill(-Infinity);
  for (let i = 1; i < n; i++) left[i] = Math.max(left[i - 1], cov[i - 1]);
  for (let i = n - 2; i >= 0; i--) right[i] = Math.max(right[i + 1], cov[i + 1]);
  return cov.map((c, i) => Math.max(0, Math.min(left[i], right[i]) - c));
}

// 存水最多的连续一段；中心 = 格中心 (i + 0.5) / N 按深度加权。
// 没有任何凹处时，退而取中间（眉长 interiorMargin ~ 1 − interiorMargin）最稀的一格，并列取靠前的。
export function biggestGap(cov, { interiorMargin = 0.2 } = {}) {
  const n = cov.length;
  const d = gapDepths(cov);
  let best = null;
  let run = null;
  for (let i = 0; i <= n; i++) {
    if (i < n && d[i] > 0) {
      run = run || { cells: [], total: 0, w: 0 };
      run.cells.push(i); run.total += d[i]; run.w += d[i] * (i + 0.5);
    } else if (run) {
      if (!best || run.total > best.total) best = run;
      run = null;
    }
  }
  if (best) return { kind: 'gap', cells: best.cells, total: best.total, center: best.w / best.total / n };
  let pick = -1;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    if (u < interiorMargin || u > 1 - interiorMargin) continue;
    if (pick < 0 || cov[i] < cov[pick]) pick = i;
  }
  return { kind: 'lowest-interior', cells: [pick], total: 0, center: (pick + 0.5) / n };
}
