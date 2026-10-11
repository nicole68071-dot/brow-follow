// 眉妆跟练 v1 · 屏幕顺序。
// 2026-10-11（docs/flow-v2-proposal.md 方案乙，Nicole 定）：每步一屏"练习"——先在需要的那条眉上示范，
// 播完停在两条眉的完整目标示意、去镜前画；"跟练完成"并入最后自查。屏数随每屏任务决定，不是目标。
// 之前：D43 的 9 屏（示范、镜前分两屏，另有完成页）；更早 D41 的每步多屏在 3 步时膨胀到 21 屏。
export function buildScreens(steps) {
  const screens = [{ id: 'intro' }, { id: 'capture' }, { id: 'confirm' }];
  steps.forEach((_, i) => screens.push({ id: `s${i + 1}-practice`, step: i, moment: 'practice' }));
  screens.push({ id: 'check', step: steps.length - 1, moment: 'check' });
  screens.push({ id: 'survey' }, { id: 'summary' });
  return screens;
}

export const indexOf = (screens, id) => screens.findIndex((s) => s.id === id);

export function nextIndex(screens, i) {
  return Math.min(i + 1, screens.length - 1);
}

// 入口和结果页没有"返回"；其余回到上一屏。
export function backIndex(screens, i) {
  const id = screens[i].id;
  if (id === 'intro' || id === 'summary') return i;
  return Math.max(0, i - 1);
}

const FIXED = {
  intro: '入口', capture: '拍照', confirm: '确认起笔和收尾', check: '最后自查',
  survey: '结尾问题', summary: '结果',
};

export function screenLabel(screen, steps) {
  if (FIXED[screen.id]) return FIXED[screen.id];
  return `第${screen.step + 1}步「${steps[screen.step].title}」`;
}
