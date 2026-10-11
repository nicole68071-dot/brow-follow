// 眉妆跟练 v1 · 内容就绪检查（D41："不得用占位视频和任意定位规则冒充已完成"）。
// blocking 非空时，页面顶部常驻"内容未就绪"横幅；这个链接不应发出去。
export function contentReadiness(c) {
  const blocking = [];
  const advisory = [];
  const need = (ok, key, what) => { if (!ok) blocking.push({ key, what }); };

  need(c.scope?.pencil, 'scope.pencil', '这一版适用的眉笔类型');
  need(c.scope?.situation, 'scope.situation', '适用的情况（谁适合、谁不适合）');
  for (const [k, r] of Object.entries(c.rules)) {
    need(r.why, `rules.${k}.why`, `「${r.label}」的理由（核实后的说法）`);
    need(r.source, `rules.${k}.source`, `「${r.label}」规则的来源`);
  }
  c.steps.forEach((s, i) => need(!s.clip?.localOnlyAsset, `steps[${i}].clip.asset`,
    `第${i + 1}步的示范素材只能本机测试（${s.clip?.localOnlyAsset}），发出去之前要换成有授权的照片`));
  c.steps.forEach((s, i) => need(s.clip?.src, `steps[${i}].clip`, `第${i + 1}步「${s.title}」的示范（D42：有依据的动作模板或片段）`));
  need(c.durationMinutes, 'durationMinutes', '自己完整走一遍的实测时长（邀请里写时长之前要有）');

  c.steps.forEach((s, i) => {
    if (s.review !== 'done') advisory.push({ key: `steps[${i}].review`, what: `第${i + 1}步的文字请熟手看一遍` });
    if (s.region?.basisPending) advisory.push({ key: `steps[${i}].region`, what: `第${i + 1}步的区域取值：${s.region.basis}` });
  });
  return { ready: blocking.length === 0, blocking, advisory };
}
