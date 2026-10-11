// 眉妆跟练 v1 · 本机记录与文字结果（D41）。
// 没有后端：记录只在这台手机的内存里，结束时生成一段文字，由用户自己决定是否复制发送。
// 结果里不放照片、不放关键点坐标——只放停留时长、操作次数、拖动距离（相对值）和用户自己写的话。

export function createLog(now = () => Date.now()) {
  const t0 = now();
  const events = [];
  return {
    t0,
    events,
    add(type, data = {}) {
      const e = { t: now() - t0, type, ...data };
      events.push(e);
      return e;
    },
    elapsed: () => now() - t0,
  };
}

export function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 每一屏累计停留（来回进出会累加），按首次进入的顺序。
export function screenDurations(events, endT) {
  const enters = events.filter((e) => e.type === 'screen');
  const out = new Map();
  enters.forEach((e, k) => {
    const until = k + 1 < enters.length ? enters[k + 1].t : endT;
    out.set(e.id, (out.get(e.id) || 0) + Math.max(0, until - e.t));
  });
  return out;
}

const off = (v) => (v == null ? '—' : v.toFixed(2));
const NEEDS = [['headLen', '眉头要延长'], ['headDen', '眉头要加密'], ['body', '眉身要补'], ['tailLen', '眉尾要延长'], ['tailDen', '眉尾要加密']];

export function summarize({ events, endT, labelOf, version, startedAt, survey = {} }) {
  const lines = [];
  lines.push(`画眉跟练 · 结果（v${version}）`);
  lines.push(`开始 ${startedAt}　总用时 ${mmss(endT)}`);

  const end = [...events].reverse().find((e) => e.type === 'end');
  lines.push(end?.how === 'stuck'
    ? `结束方式：中途结束，停在 ${labelOf(end.id)}`
    : '结束方式：走完全程');

  const stuck = events.filter((e) => e.type === 'stuck');
  lines.push('');
  lines.push(stuck.length ? '[卡住]' : '[卡住] 没有');
  for (const s of stuck) {
    lines.push(`  · ${labelOf(s.id)}（${mmss(s.t)}）：${s.reason}${s.note ? `——「${s.note}」` : ''}`);
  }

  const pts = [...events].reverse().find((e) => e.type === 'points');
  lines.push('');
  lines.push('[起笔/收尾调整]（单位：两眼外角距离；0.00 表示没动）');
  if (pts) {
    for (const s of pts.sides) lines.push(`  ${s.label}：起笔 ${off(s.startOff)}　收尾 ${off(s.endOff)}`);
    lines.push(`  照片来源：${pts.source === 'camera' ? '前置相机' : pts.source === 'file' ? '相册' : pts.source}　左右翻转：${pts.flipped ? '是' : '否'}`);
  } else {
    lines.push('  （没有走到这一步）');
  }

  // 目标标出的地方（每条眉 5 项 + 笔数）：和结尾"同意吗"对照，看判断准不准
  const needs = [...events].reverse().find((e) => e.type === 'needs');
  lines.push('');
  if (needs) {
    lines.push('[目标标出的地方]');
    for (const s of needs.sides) {
      const marks = NEEDS.filter(([k]) => s[k]).map(([, name]) => name);
      lines.push(`  ${s.label}：${marks.length ? `${marks.join('、')}（${s.strokes} 笔）` : '不用补'}`);
    }
  } else {
    lines.push('[目标标出的地方] （没有走到这一步）');
  }

  lines.push('');
  lines.push('[每一屏停留]');
  for (const [id, ms] of screenDurations(events, endT)) {
    if (id === 'summary') continue; // 结果页本身不算
    lines.push(`  ${labelOf(id)}  ${mmss(ms)}`);
  }

  const replays = new Map();
  for (const e of events.filter((x) => x.type === 'replay')) replays.set(e.step, (replays.get(e.step) || 0) + 1);
  lines.push('');
  lines.push(`[示范重播] ${replays.size ? [...replays].map(([s, n]) => `第${s + 1}步 ${n} 次`).join(' · ') : '没有'}`);
  lines.push(`[返回] ${events.filter((e) => e.type === 'back').length} 次`);

  lines.push('');
  lines.push('[结尾]');
  lines.push(`  愿意就这样出门吗：${survey.goOut || '（没答）'}`);
  const where = [survey.targetSide, survey.targetParts?.join('、')].filter(Boolean).join(' · ');
  lines.push(`  目标上要补的地方：${survey.targetAgree || '（没答）'}${where ? `（${where}）` : ''}`);
  lines.push(`  最有帮助：${survey.mostHelpful || '（没答）'}`);
  lines.push(`  最困惑：${survey.confusing || '（没答）'}`);
  lines.push(`  这次有答案的问题：${survey.answered?.length ? survey.answered.join('、') : '（没选）'}`);
  return lines.join('\n');
}
