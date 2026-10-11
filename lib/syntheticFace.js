// 开发与测试用的合成脸——不是人脸模型。
// 只放眉妆定位用到的关键点，其余点堆在脸中心。用途：没有真实照片时，让几何测试和整条页面流程能跑通。
// ⚠️ 真实人脸上的定位效果，必须用真照片验证；合成脸跑通不代表定位在真人脸上成立。
import { BROW_GUIDE_LANDMARKS } from './browGuide.js';

// 基准坐标系 1000 × 1300（canonical_unmirrored：被拍者的左侧在画面右边）
const BASE_W = 1000;
const BASE_H = 1300;
const PIVOT = { x: 500, y: 650 };
const LEFT_MIDS = [[560, 400], [600, 388], [640, 382], [680, 388], [720, 402]];

function basePoints({ noseWingDx }) {
  const pts = new Map();
  const set = (i, x, y) => pts.set(i, { x, y });
  set(BROW_GUIDE_LANDMARKS.left.eyeOuter, 650, 500);
  set(BROW_GUIDE_LANDMARKS.right.eyeOuter, 350, 500);
  set(BROW_GUIDE_LANDMARKS.left.noseWing, 500 + noseWingDx, 620);
  set(BROW_GUIDE_LANDMARKS.right.noseWing, 500 - noseWingDx, 620);
  BROW_GUIDE_LANDMARKS.left.centerlinePairs.forEach(([i, j], k) => {
    const [x, y] = LEFT_MIDS[k];
    set(i, x, y + 9); set(j, x, y - 9);
  });
  BROW_GUIDE_LANDMARKS.right.centerlinePairs.forEach(([i, j], k) => {
    const [x, y] = LEFT_MIDS[k];
    set(i, 1000 - x, y + 9); set(j, 1000 - x, y - 9);
  });
  return pts;
}

export function rotateAround(p, c, deg) {
  const r = (deg * Math.PI) / 180;
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) };
}

export function syntheticFace({ W = BASE_W, H = BASE_H, rotateDeg = 0, noseWingDx = 75 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [i, p] of basePoints({ noseWingDx })) {
    const q = rotateAround(p, PIVOT, rotateDeg);
    landmarks[i] = { x: q.x / BASE_W, y: q.y / BASE_H, z: 0 };
  }
  return { W, H, landmarks };
}

// 画一张示意脸（canonical 空间），只为开发时肉眼核对叠加层位置。眉尾故意画稀，模拟"眉尾稀疏"。
export function drawSyntheticFace(ctx, W, H, rotateDeg = 0) {
  ctx.save();
  ctx.scale(W / BASE_W, H / BASE_H);
  ctx.fillStyle = '#CFC5B8';
  ctx.fillRect(0, 0, BASE_W, BASE_H);
  ctx.translate(PIVOT.x, PIVOT.y);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.translate(-PIVOT.x, -PIVOT.y);
  ctx.fillStyle = '#3A2A22';
  ctx.beginPath(); ctx.ellipse(500, 560, 330, 420, 0, Math.PI, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = '#EDC7A9';
  ctx.beginPath(); ctx.ellipse(500, 640, 290, 400, 0, 0, 2 * Math.PI); ctx.fill();
  for (const sx of [1, -1]) {
    const ex = 500 + sx * 92;
    ctx.fillStyle = '#FBF7F2';
    ctx.beginPath(); ctx.ellipse(ex, 502, 62, 22, 0, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#3C2A20';
    ctx.beginPath(); ctx.arc(ex, 502, 15, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#3C2A20'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(ex, 502, 62, 22, 0, Math.PI, 2 * Math.PI); ctx.stroke();
    const mids = LEFT_MIDS.map(([x, y]) => [sx === 1 ? x : 1000 - x, y]);
    ctx.strokeStyle = '#4A3327'; ctx.lineCap = 'round';
    ctx.lineWidth = 16; ctx.globalAlpha = 0.85;
    ctx.beginPath(); mids.slice(0, 4).forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.lineWidth = 6; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(...mids[3]); ctx.lineTo(...mids[4]); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#D3A07A';
    ctx.beginPath(); ctx.arc(500 + sx * 75, 620, 14, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.strokeStyle = '#D3A07A'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(500, 520); ctx.lineTo(492, 610); ctx.stroke();
  ctx.fillStyle = '#C4877E';
  ctx.beginPath(); ctx.ellipse(500, 790, 85, 28, 0, 0, 2 * Math.PI); ctx.fill();
  ctx.restore();
}
