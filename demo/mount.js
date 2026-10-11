// D42 · 三笔示范的界面挂载（审阅页 stroke-demo.html 与跟练第 2 步"看示范"共用）。
// 画面一律由 frameOf(player) → renderSvg(frame) 得到；这里只负责时钟、页面可见性和对外的几个操作。
import {
  validateScript, createPlayer, tick, pause, resume, replay, hide, show, requestAdvance, frameOf,
} from '../lib/strokeDemo.js';
import { renderSvg } from '../lib/strokeRender.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// clock: 'raf'（默认）| 'interval'（开发：浏览器面板隐藏时 rAF 不触发，用定时器验证）
// startAt: 开发用，停在某个时刻截关键帧
export function mountStrokeDemo(el, script, { mirror = false, clock = 'raf', startAt = null, onChange = () => {} } = {}) {
  const issues = validateScript(script);
  if (issues.length) {
    el.innerHTML = `<p class="stroke-err">脚本缺项：${esc(issues.map((i) => `${i.at} 缺 ${i.missing}`).join('；'))}</p>`;
    return null;
  }
  let player = createPlayer(script);
  if (startAt != null) player = pause(tick(player, startAt));
  let mir = mirror;
  let last = null;
  let drawn = '';
  let alive = true;
  let raf = 0;
  let timer = 0;
  const idPrefix = `sd${Math.random().toString(36).slice(2, 7)}`;

  function draw(force = false) {
    const key = `${player.t}|${player.status}|${mir}`;
    if (!force && key === drawn) return;
    drawn = key;
    const f = frameOf(player);
    el.innerHTML = renderSvg(f, script, { mirror: mir, idPrefix });
    onChange(player, f);
  }
  function step(now) {
    if (player.status === 'playing') {
      if (last != null) player = tick(player, now - last);
      last = now;
    } else {
      last = null;
    }
    draw();
  }
  function loop(now) {
    if (!alive) return;
    step(now);
    raf = requestAnimationFrame(loop);
  }
  const onVisibility = () => { player = document.hidden ? hide(player) : show(player); draw(); };
  document.addEventListener('visibilitychange', onVisibility);

  const probe = new Image();
  probe.onload = () => {
    if (!alive) return;
    if (clock === 'interval') timer = setInterval(() => step(performance.now()), 50);
    else raf = requestAnimationFrame(loop);
  };
  probe.onerror = () => {
    if (!alive) return;
    el.innerHTML = `<p class="stroke-err">没有底图：示范需要 follow/${esc(script.scene.image.href)}（只在本机，不提交）。</p>`;
  };
  probe.src = script.scene.image.href;
  draw(true);

  return {
    get status() { return player.status; },
    toggle() { player = player.status === 'paused' ? resume(player) : pause(player); draw(); },
    replay() { player = replay(player); draw(); },
    advance() { player = requestAdvance(player); draw(); },
    setMirror(on) { mir = on; draw(); },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
