// D42 阶段 B · 眉身局部三笔示范的播放模型（纯函数，不碰 DOM、不读时钟）。
//
// 一条时间线、一个时间 t：笔尖、接触提示、新增颜色、字幕全部由 frameAt(script, t) 从同一个 t 派生，
// 不各自计时、不各自循环。大步长和小步长走到同一个 t，得到同一帧。
//
// 每一笔：接近（第一笔）或换位（之后各笔）→ 落笔 → 画 → 提笔。颜色只在"画"的阶段增长；
// 落笔那一下、提笔、换位都不出色。演示走完进入等待，时间流逝不会把它带走；
// "继续"只记作用户请求推进，不代表画对（没有 confirmed / correct 这类字段）。

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const unit = (a) => { const n = Math.hypot(a.x, a.y) || 1; return { x: a.x / n, y: a.y / n }; };
const hasSource = (s) => typeof s === 'string' && /https:\/\/\S+/.test(s);

export const strokeEnd = (s) => add(s.start, mul(unit(s.dir), s.length));

// ---------- 脚本校验：只证明结构齐全，不证明内容正确 ----------
export function validateScript(script) {
  const issues = [];
  if (!script.stop?.rule || !hasSource(script.stop?.source)) issues.push({ at: 'script', missing: 'stop' });
  (script.strokes || []).forEach((s, i) => {
    const at = `strokes[${i}]`;
    for (const k of ['start', 'dir', 'length', 'axis']) if (s[k] == null) issues.push({ at, missing: k });
    if (!hasSource(s.source)) issues.push({ at, missing: 'source' });
    if (i > 0) {
      if (!s.connection?.rule) issues.push({ at, missing: 'connection' });
      else if (!hasSource(s.connection.source)) issues.push({ at, missing: 'connection.source' });
    }
  });
  if (!(script.strokes || []).length) issues.push({ at: 'script', missing: 'strokes' });
  return issues;
}

// ---------- 时间线 ----------
export function timeline(script) {
  const T = script.timing;
  const segs = [];
  let t = 0;
  script.strokes.forEach((_, i) => {
    for (const phase of [i === 0 ? 'approach' : 'travel', 'contact', 'move', 'lift']) {
      segs.push({ stroke: i, phase, t0: t, t1: t + T[phase] });
      t += T[phase];
    }
  });
  // 方案 B：最后用眉刷刷开（ABH、Benefit：画完用螺旋刷晕开）。颜色不再增加，只是晕开
  if (T.blend > 0 && script.strokes.length) {
    segs.push({ stroke: script.strokes.length - 1, phase: 'blend', t0: t, t1: t + T.blend });
    t += T.blend;
  }
  return { segs, total: t };
}

const hoverPoint = (script, i) => add(script.strokes[i].start, mul(unit(script.strokes[i].axis), script.timing.hover));
const flickEnd = (script, i) => add(strokeEnd(script.strokes[i]), mul(unit(script.strokes[i].dir), script.timing.flick));

export function frameAt(script, tRaw) {
  const { segs, total } = timeline(script);
  const t = Math.max(0, Math.min(tRaw, total));
  const n = script.strokes.length;
  const reveal = new Array(n).fill(0);

  const hasBlend = script.timing.blend > 0;
  if (t >= total) {
    reveal.fill(1);
    const i = n - 1;
    return {
      t, phase: 'waiting', strokeIndex: i, subtitle: script.subtitles.waiting, blend: hasBlend ? 1 : 0,
      pencil: { tip: flickEnd(script, i), axis: unit(script.strokes[i].axis), contact: false, visible: !hasBlend },
      hint: { visible: false, at: flickEnd(script, i) },
      reveal,
    };
  }

  const seg = segs.find((s) => t >= s.t0 && t < s.t1);
  const i = seg.stroke;
  const k = (t - seg.t0) / (seg.t1 - seg.t0);
  const s = script.strokes[i];
  for (let j = 0; j < i; j++) reveal[j] = 1;
  if (seg.phase === 'blend') {
    reveal.fill(1);
    return {
      t, phase: 'blend', strokeIndex: i, subtitle: script.subtitles.blend, blend: k,
      pencil: { tip: flickEnd(script, i), axis: unit(s.axis), contact: false, visible: false },
      hint: { visible: false, at: flickEnd(script, i) },
      reveal,
    };
  }

  let tip;
  let axis = unit(s.axis);
  let contact = false;
  switch (seg.phase) {
    case 'approach': tip = lerp(hoverPoint(script, i), s.start, k); break;
    case 'travel':
      tip = lerp(flickEnd(script, i - 1), s.start, k);
      axis = unit(lerp(unit(script.strokes[i - 1].axis), unit(s.axis), k));
      break;
    case 'contact': tip = s.start; contact = true; break;
    case 'move': tip = lerp(s.start, strokeEnd(s), k); contact = true; reveal[i] = k; break;
    case 'lift': tip = lerp(strokeEnd(s), flickEnd(script, i), k); reveal[i] = 1; break;
    default: throw new Error(`unknown phase ${seg.phase}`);
  }
  // 每一笔可以带一句自己的话（例如"眉头：往上斜画，短而轻"），整笔都显示它。
  // 2026-10-11 真机录屏复查：原来落笔后换回逐动作字幕，一笔里换 4 句、每句 0.25–0.7 秒，看不完。没有自己的话的笔仍用逐阶段字幕。
  return {
    t, phase: seg.phase, strokeIndex: i, subtitle: s.say || script.subtitles[seg.phase], blend: 0,
    pencil: { tip, axis, contact, visible: true },
    hint: { visible: contact, at: tip },
    reveal,
  };
}

// ---------- 一帧内部是否自洽（错误样本靠它抓） ----------
export function frameIssues(f, script) {
  const issues = [];
  if (f.hint.visible !== f.pencil.contact) issues.push({ code: 'hint-not-synced', t: f.t });
  if (f.hint.visible && Math.hypot(f.hint.at.x - f.pencil.tip.x, f.hint.at.y - f.pencil.tip.y) > 1e-6) {
    issues.push({ code: 'hint-off-tip', t: f.t });
  }
  f.reveal.forEach((r, j) => {
    if (r > 0 && r < 1 && !f.pencil.contact) issues.push({ code: 'pigment-without-contact', t: f.t, stroke: j });
    if (j > f.strokeIndex && r > 0) issues.push({ code: 'pigment-before-stroke', t: f.t, stroke: j });
  });
  if (f.phase === 'move') {
    const s = script.strokes[f.strokeIndex];
    const front = add(s.start, mul(unit(s.dir), s.length * f.reveal[f.strokeIndex]));
    if (Math.hypot(front.x - f.pencil.tip.x, front.y - f.pencil.tip.y) > 1e-6) {
      issues.push({ code: 'reveal-ahead-of-tip', t: f.t, stroke: f.strokeIndex });
    }
  }
  return issues;
}

// ---------- 播放器：只保存 t 和状态，画面一律由 frameAt 派生 ----------
export function createPlayer(script) {
  return Object.freeze({ script, total: timeline(script).total, t: 0, status: 'playing' });
}
const set = (p, patch) => Object.freeze({ ...p, ...patch });

export function tick(p, dtMs) {
  if (p.status !== 'playing') return p;
  const t = Math.min(p.t + Math.max(0, dtMs), p.total);
  return set(p, { t, status: t >= p.total ? 'waiting' : 'playing' });
}
export const pause = (p) => (p.status === 'playing' ? set(p, { status: 'paused' }) : p);
export const resume = (p) => (p.status === 'paused' ? set(p, { status: 'playing' }) : p);
export const replay = (p) => set(p, { t: 0, status: 'playing', advanceRequested: false });
export const hide = (p) => (p.status === 'playing' ? set(p, { status: 'paused', pausedByHide: true }) : p);
export const show = (p) => p; // 回来后保持暂停，等用户自己点继续
export const requestAdvance = (p) => (p.status === 'waiting' ? set(p, { status: 'practice', advanceRequested: true }) : p);
export const frameOf = (p) => frameAt(p.script, p.t);

// ---------- D43 教学播放器的读数：进度条、第几笔、播放状态，都从同一个播放器状态读出 ----------
export function readout(p) {
  const f = frameOf(p);
  const ended = p.status === 'waiting' || p.status === 'practice';
  return {
    fraction: p.total ? p.t / p.total : 0,
    stroke: f.strokeIndex + 1,
    strokes: p.script.strokes.length,
    state: ended ? 'ended' : p.status === 'paused' ? 'paused' : 'playing',
  };
}

// 进度条刻度：每一笔落笔的时刻（占总长的比例）
export function strokeMarks(script) {
  const { segs, total } = timeline(script);
  return segs.filter((s) => s.phase === 'contact').map((s) => s.t0 / total);
}
