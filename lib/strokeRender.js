// D42 阶段 B · 把一帧画成 SVG 字符串（纯函数）。
//
// 只消费 frameAt() 给出的帧：笔尖、接触提示、颜色前沿都直接取帧里的值，这里不计时、不推算。
// 新增颜色是独立的一层（底图原样保留、不隐藏原生眉毛），每一笔用 SVG mask 沿笔画方向露出。
// 显示镜像：整幅画面（底图、颜色、提示、笔）只套一层变换，镜像轴取裁切框中线，规则复用 lib/mirror.js；
// 字幕不在 SVG 里，镜像时照样可读。镜像只改显示，不改帧、不改脚本、不等于换到另一条眉。
// 本版只画笔、不画手（握笔位置与借力缺依据，见 docs/d42-stage-a-brow-stroke-evidence.md）。

import { mirrorPoint } from './mirror.js';

const n = (v) => String(+v.toFixed(3));
const unit = (a) => { const k = Math.hypot(a.x, a.y) || 1; return { x: a.x / k, y: a.y / k }; };

// 一笔像一根毛（2026-10-09 Nicole：不要几何楔形）：中线微弯；粗细从根部到尖端非线性收细（根部实、中段细长、末端收尖）；
// 颜色沿笔画渐淡（根部浓、尖端淡）；叠加用 multiply，几笔重叠会逐渐加深，不会一下子变成深色块。
function pigment(s, j, reveal, style, idp, highlight = false, haloOut = null) {
  const d = unit(s.dir);
  const nrm = { x: -d.y, y: d.x };
  const L = s.length;
  const e = { x: s.start.x + d.x * L, y: s.start.y + d.y * L };
  const bend = 0.06 * L;
  const c = { x: (s.start.x + e.x) / 2 + nrm.x * bend, y: (s.start.y + e.y) / 2 + nrm.y * bend };
  const K = 10;
  const left = []; const right = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    const p = { x: (1 - t) ** 2 * s.start.x + 2 * (1 - t) * t * c.x + t ** 2 * e.x, y: (1 - t) ** 2 * s.start.y + 2 * (1 - t) * t * c.y + t ** 2 * e.y };
    const tg = unit({ x: 2 * (1 - t) * (c.x - s.start.x) + 2 * t * (e.x - c.x), y: 2 * (1 - t) * (c.y - s.start.y) + 2 * t * (e.y - c.y) });
    // 根部也稍收（原来根部是平头，像一截剪断的线）：前 15% 从 0.55 倍宽涨到全宽
    const w = ((style.widthStart * (1 - t) ** 0.7 + style.widthEnd * t) / 2) * (0.55 + 0.45 * Math.min(1, t / 0.15));
    left.push(`${n(p.x - tg.y * w)} ${n(p.y + tg.x * w)}`);
    right.push(`${n(p.x + tg.y * w)} ${n(p.y - tg.x * w)}`);
  }
  const front = { x: s.start.x + d.x * L * reveal, y: s.start.y + d.y * L * reveal };
  const id = `${idp}m${j}`;
  const gid = `${idp}g${j}`;
  const op = style.opacity * (s.weight ?? 1);
  const hl = highlight
    ? `<line data-role="highlight" class="sd-hl" x1="${n(s.start.x)}" y1="${n(s.start.y)}" x2="${n(front.x)}" y2="${n(front.y)}" stroke="#7FD3C7" stroke-width="${n(style.widthStart * 2.8)}" stroke-linecap="round"/>`
    : '';
  if (haloOut) haloOut.push(`<path data-role="halo" d="M${left.join(' L')} L${[...right].reverse().join(' L')} Z" fill="${style.color}" fill-opacity="${n(op * 0.6 * haloOut.blend)}" filter="url(#${idp}hb)" style="mix-blend-mode:${style.blendMode || 'multiply'}"/>`);
  return `${hl}<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n(s.start.x)}" y1="${n(s.start.y)}" x2="${n(e.x)}" y2="${n(e.y)}">`
    + `<stop offset="0" stop-color="${style.color}" stop-opacity="${n(op)}"/><stop offset="1" stop-color="${style.color}" stop-opacity="${n(op * 0.3)}"/></linearGradient>`
    + `<mask id="${id}"><line data-stroke="${j}" x1="${n(s.start.x)}" y1="${n(s.start.y)}" x2="${n(front.x)}" y2="${n(front.y)}" stroke="#fff" stroke-width="${n(Math.max(style.widthStart * 4, 0.14 * L + style.widthStart))}" stroke-linecap="butt"/></mask>`
    + `<path data-role="pigment" d="M${left.join(' L')} L${[...right].reverse().join(' L')} Z" fill="url(#${gid})" style="mix-blend-mode:${style.blendMode || 'multiply'}" mask="url(#${id})"/>`;
}

function pencil(p) {
  const deg = (Math.atan2(p.axis.y, p.axis.x) * 180) / Math.PI;
  // 离开皮肤时影子和笔尖分开；接触时影子贴住笔尖（二维里表达"提起来了"的办法，是否看得懂要人工核对）
  const sh = p.contact ? { dx: 1.2, dy: 1.6, o: 0.3 } : { dx: 6, dy: 8, o: 0.18 };
  const shape = '<polygon points="0,0 9,-3 9,3"/><rect x="9" y="-3.4" width="170" height="6.8" rx="1.2"/>';
  return `<g data-role="pencil" data-contact="${p.contact}" transform="translate(${n(p.tip.x)} ${n(p.tip.y)}) rotate(${n(deg)})">`
    + `<g transform="translate(${sh.dx} ${sh.dy})" fill="#000" fill-opacity="${sh.o}">${shape}</g>`
    + '<polygon points="0,0 9,-3 9,3" fill="#d9b48a"/><polygon points="0,0 3.2,-1.1 3.2,1.1" fill="#4a3530"/>'
    + '<rect x="9" y="-3.4" width="170" height="6.8" rx="1.2" fill="#2f2f33" fill-opacity="0.82"/></g>';
}

// showPencil: false 用于目标图（示范的最后一帧，只看结果）
// 方案 B：底色 = 每一笔晕开的一圈（frame.blend > 0 时），没有笔就没有底色；原"整条眉形多边形底色"已撤掉。
export function renderSvg(frame, script, { mirror = false, idPrefix = 'sd', showPencil = true, highlight = false } = {}) {
  const { image, crop } = script.scene;
  const parts = [`<image data-role="base" href="${image.href}" x="0" y="0" width="${image.width}" height="${image.height}"/>`];
  const halos = Object.assign([], { blend: frame.blend || 0 });
  const pigments = [];
  frame.reveal.forEach((r, j) => {
    if (r > 0) pigments.push(pigment(script.strokes[j], j, r, script.style, idPrefix, highlight, halos.blend > 0 ? halos : null));
  });
  if (halos.length) {
    parts.push(`<filter id="${idPrefix}hb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(script.style.blur ?? script.style.widthStart * 3)}"/></filter>`, ...halos);
  }
  parts.push(...pigments);
  if (frame.hint.visible) {
    parts.push(`<circle data-role="hint" cx="${n(frame.hint.at.x)}" cy="${n(frame.hint.at.y)}" r="5" fill="none" stroke="#1f8a7a" stroke-width="1.4"/>`);
  }
  if (showPencil && frame.pencil.visible !== false) parts.push(pencil(frame.pencil));

  const c = mirrorPoint({ x: 0, y: 0 }, 2 * crop.x + crop.w).x; // 镜像轴 = 裁切框中线
  const open = mirror
    ? `<g data-role="mirror" transform="matrix(-1 0 0 1 ${n(c)} 0)">`
    : '<g data-role="scene">';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" data-brow="${script.scope.brow}" role="img" aria-label="画眉示范">`
    + `${open}${parts.join('')}</g></svg>`;
}
