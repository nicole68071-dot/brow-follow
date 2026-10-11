// 眉妆跟练 v1 · 内容（D41 → D42 → D43）
//
// 这是"内容工作"的唯一落点：给用户看的每一句话、定位规则的说法与来源、每一步的示范。
// 值为 null 的字段 = 还没就绪；页面顶部会常驻"内容未就绪"横幅（lib/readiness.js）。
// ⛔ 不要用占位视频、或没有来源的规则把它们填满——那正是 D41 禁止的"冒充已完成"。
//
// D43（2026-10-09 手机实测）：主画面每屏只有一句短字幕（≤ 16 字，测试拦截），尽量不出文字、不占视觉；
// 适用范围、测试说明、隐私全文收进入口的 ⓘ；起笔收尾的理由精简成一句，配示意图放在确认页。
// "只画笔不画手"是项目实现上的限制，只写在审阅文档里，不给用户看（测试拦截）。
// 只教"轻补眉毛"一步；两条眉分开练（先镜子里右边），每条示范它自己要补的几组；刷顺是入口工具里的可选准备，不单独成一步；没有"再刷一遍"；自查只在最后一次。
//
// 文字出处：主方法 = L'Oréal Paris 加拿大站《How to Do Your Eyebrows for Your Face Shape》，与起笔、收尾同一页；
// 单笔手法用 ABH / Benefit 官方产品页补（见 steps[].sources 与 demo/script.js）。依据核对见 docs/d42-stage-a-brow-stroke-evidence.md。
// "沿眉形""顺眉"这类没有来源的轴向说法仍禁止 —— test/followContent.test.js 会拦住。

export const FOLLOW_CONTENT = {
  version: '0.3.1',
  feedbackTo: 'Nicole',

  // 2026-10-08 Nicole 确认。依据：单笔手法的来源（ABH Brow Wiz、Benefit Precisely, My Brow 产品页）都是细头铅笔式眉笔；
  // ABH 产品页写明极稀疏的眉要先用别的产品打底；L'Oréal FAQ 是只补稀疏处、保留原有眉形。
  scope: {
    pencil: '细头眉笔（笔芯细到能画出一根根毛的那种）',
    situation: '适合有眉毛、只是有些地方毛少的人；眉毛几乎没有、或者想改眉形的，这一版不适用。',
  },

  durationMinutes: null, // 自己完整走一遍计时后填写；填之前，入口和邀请都不写时长

  intro: {
    title: '跟着画眉毛',
    // 入口只画用到的化妆工具（D43：镜子不画）
    tools: [
      { icon: 'pencil', name: '细头眉笔' },
            // 方案 B（2026-10-10）：画完用眉刷刷开成了要教的动作（ABH、Benefit：画完用螺旋刷晕开）；画前刷顺仍是可做可不做
      { icon: 'brush', name: '眉刷', note: '画完刷开（眉笔另一头也行）', source: "ABH Brow Wiz 产品页 HOW TO APPLY（blend with the spoolie）· https://www.anastasiabeverlyhills.com/products/brow-wiz" },
    ],
    info: [
      '这个小工具会在你自己的照片上标出从哪里起笔、画到哪里停，示范怎么轻补眉毛，然后你对着镜子画。',
      '这是在测试这个方法好不好用，不是测你画得好不好。',
      '照片只在你的手机里处理，不会上传。最后会生成一段文字结果（不含照片），由你决定要不要发给 {feedbackTo}。',
    ],
  },

  capture: {
    line: '正脸，露出眉毛，看完再对镜子画',
    privacy: '照片只在手机里处理',
  },

  // D43：原 ⓘ"为什么在这里"精简成一句理由 + 示意图，放在"不对就拖动"下面
  confirm: {
    line: '不对就拖动',
    why: '用鼻孔外缘对照，下次自己也能找到',
    diagram: ['鼻孔外缘', '外眼角', '起笔', '收尾'],
  },

  // 定位规则（2026-10-07，Nicole 同意；见决策文档 D41 增补）
  // 来源 = 一个具体页面，不是品牌：L'Oréal 各官方页面彼此不一致，"三点同源"以页面为单位。
  // 这一页只讲怎么找、不讲为什么，所以理由只写它能支撑的说法——"有参照、能在自己脸上重新找到"；
  // 原先草拟的审美理由（"再往里会挤""比它长显得拖沓"）没有出处，已删除。
  // 将来加眉峰（v1 不做），必须取自同一页："同侧鼻孔 → 眼睛中心、穿过瞳孔"。
  rulesNote: '这两个点的找法来自 L’Oréal Paris 官方教程。它是一个起点，不是唯一答案。',
  rules: {
    start: {
      label: '起笔',
      how: '从鼻孔外缘竖直往上，碰到眉毛的地方，作为起笔的参考。',
      why: '用鼻孔外缘当参照，不用凭感觉估；下次照镜子时你也能自己找到。',
      source: "L'Oréal Paris 加拿大站《How to Do Your Eyebrows for Your Face Shape》Step 1: Find the three points（inner corner）· https://www.lorealparis.ca/en-ca/how-to-shape-your-eyebrows-for-your-face-shape",
    },
    end: {
      label: '收尾',
      how: '从鼻孔外缘经过外眼角连一条斜线，延长到眉毛的高度，作为收尾的参考。',
      why: '从同一个参照点连到外眼角，眉毛画多长就有了依据，不靠感觉。',
      source: "L'Oréal Paris 加拿大站《How to Do Your Eyebrows for Your Face Shape》Step 1: Find the three points（outer corner）· https://www.lorealparis.ca/en-ca/how-to-shape-your-eyebrows-for-your-face-shape",
    },
  },

  steps: [
    {
      title: '轻补眉毛', // 2026-10-10 Nicole 定：描述动作、符合短而轻的笔触；不先断言用户"毛少"
      region: { from: 0, to: 1 },
      // D43（2026-10-09）：示范用用户自己的照片现场生成 —— 在她自己的眉上，从眉头往眉尾画：眉头斜竖 3 笔、眉身空隙 2 笔、眉尾延长 2 笔
      // （lib/strokePlan.js + lib/ownScript.js）。不再用朋友的照片，所以没有"只能本机测试"的素材。
      clip: {
        kind: 'own-photo',
        src: 'own-photo',
        need: '在用户自己的照片上生成：眉头斜竖 3 笔、眉身空隙 2 笔、眉尾延长 2 笔，从眉头往眉尾',
      },
      sources: [
        "L'Oréal 加拿大站 Step 3: Get out your brow filler；FAQ（只补稀疏处、不画太实的轮廓）；Final eyebrow tips（不先勾边） · https://www.lorealparis.ca/en-ca/how-to-shape-your-eyebrows-for-your-face-shape",
        "ABH Brow Wiz 产品页 PRO TIPS（斜拿、轻放笔尖、甩腕）、HOW TO APPLY（顺着毛长的方向） · https://www.anastasiabeverlyhills.com/products/brow-wiz",
        "Benefit Precisely, My Brow Pencil 产品页 FAQ、HOT TIP（短而轻、顺着毛长的方向） · https://www.benefitcosmetics.com/en-us/product/precisely-my-brow-eyebrow-pencil-BM93.html",
      ],
      review: 'pending',
    },
  ],

  // 2026-10-11 Nicole 定：最后自查保留一个明确的检查时刻，检查的是镜子里实际画出的眉毛（手机上只是目标示意）；
  // "跟练完成"并入这一屏。出处：范围 = L'Oréal Step 1、3（起笔收尾、补到眉尾为止）；浓淡 = Step 4（太实就刷开）。
  // 两项是 Nicole 的原文，超过 16 字（检查项不是字幕）；要不要缩短待她定。
  check: {
    line: '对着镜子，最后看两处。',
    items: ['范围：有没有画过确认的起笔、收尾位置？', '浓淡：有没有一块颜色明显太实？需要时用眉刷轻轻刷开。'],
  },

  // 屏幕标签与固定提示（docs/ui-copy-guide.md：同一个东西全程一个名字；内部名不上屏；不替算法夸口）
  ui: {
    confirmChip: '起笔和收尾',     // 原"确认位置"：太泛
    surveyChip: '几个小问题',      // 原"最后"：和"最后自查"两个"最后"
    demoBadge: '示范',             // 原"示范 · 每类笔怎么画"："类"是内部分组；示范也不是慢放
    skip: '跳过',                  // 没有东西要画时，示范和镜前的主按钮（很少见，Nicole 2026-10-10：不单独设计）
    // 2026-10-11 布局 D（Nicole 定）：两条眉分开练，先镜子里右边、再镜子里左边；不用补的那条跳过，标签上注明
    drawRight: '对照着，画镜子里右边这条',
    drawLeft: '对照着，画镜子里左边这条',
    sideDone: '这边画好了', // 还有另一边要画时
    drawDone: '画好了',     // 最后一边
    sideSkip: '不用补',
    noneToFill: '两条眉都不用补',
    // 原"按住看原图"：手机上和 Safari 长按选字冲突（2026-10-10 真机录屏）⇒ 点一下切换；角标同步说现在看的是哪张
    showBefore: '看原图',
    showAfter: '看目标示意',
    targetBadge: '目标示意', // 2026-10-11 Nicole 定：免得被当成真的画完后的照片
    beforeBadge: '原图',
    checkDone: '完成，去反馈', // 最后自查的主按钮（"跟练完成"并入自查）
    replayDemo: '再看示范',    // 练习屏、自查屏都在原地重播，不跳屏
  },

  stuckReasons: [
    { code: 'P', text: '看不懂这一步要画成什么样' },
    { code: 'P', text: '在镜子里找不到起笔点或收尾点' },
    { code: 'V', text: '不知道手怎么动、笔怎么拿' },
    { code: 'V', text: '示范看不清，或者和这一步对不上' },
    { code: 'R', text: '太快了，没记住就要动手' },
    { code: 'R', text: '不知道什么时候该点下一步' },
    { code: '', text: '其他' },
  ],

  survey: {
    goOut: ['愿意', '还想改一改', '不愿意'],
    mostHelpful: ['看起笔点和收尾点', '看示范', '对照目标示意', '最后自查', '都没什么帮助'],
    answered: ['眉头从哪里起笔', '眉尾画到哪里停', '每一笔怎么画', '选什么眉形'],
    // 验证"要不要补"的判断（照片不离开手机）：分得出多画（有些地方其实不用补）和少画（有要补的地方没标出来）
    targetAgree: ['同意', '有些地方其实不用补', '有要补的地方没标出来', '两种都有', '看不出来'],
    // 答了有问题时追问哪条眉、哪一段（2026-10-10 真机录屏审阅：只答"多补 / 漏补"定位不到位置）
    targetProblems: ['有些地方其实不用补', '有要补的地方没标出来', '两种都有'],
    targetWhere: { sides: ['镜子里左边', '镜子里右边', '两边都有'], parts: ['眉头', '眉身', '眉尾'] },
  },
};
