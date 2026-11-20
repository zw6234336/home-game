import { POSE_CHALLENGES, type PoseId } from '../game/pose-match.ts';
import type { PoseSnapshot } from '../game/pose-session.ts';
import { renderMarkup } from '../platform/dom.mjs';
import { icon } from './icons.mjs';
import { poseIllustration, poseScene } from './pose-art.ts';

export function gameChoices(game: string) {
  return '<div class="game-choices" role="group" aria-label="选择游戏"><button id="game-bubbles" data-action="select-bubbles" aria-pressed="' + (game === 'bubbles') + '"><span class="game-choice-mark">01</span><span>泡泡派对<small>挥挥手，拍出快乐</small></span></button><button id="game-poses" data-action="select-poses" aria-pressed="' + (game === 'poses') + '"><span class="game-choice-mark">02</span><span>默契模仿秀<small>摆个姿势，一起过关</small></span></button></div>';
}

export function poseFeature(count: 1 | 2) {
  return '<section class="feature-scene pose-feature" aria-label="默契模仿秀游戏介绍"><div class="feature-heading"><small>MAKE A POSE, MAKE A MEMORY</small><h2>默契模仿秀</h2></div><div class="round-stamp"><b>6</b><span>张动作卡</span></div>' + poseScene(Array.from({ length: count }, () => 'airplane')) + '<div class="feature-hint">你一摆，我就懂。</div><div class="scene-labels"><span>照着做就会</span><span>各自完成，一起过关</span><span>双脚稳稳站</span></div></section>';
}

function poseCard(target: PoseId) {
  const challenge = POSE_CHALLENGES.find(item => item.id === target)!;
  return '<span class="eyebrow">跟着动作卡，轻松做</span><h2 id="pose-title">' + challenge.name + '</h2>' + poseIllustration(target) + '<p id="pose-instruction">' + challenge.instruction + '</p><span class="pose-card-note">做到了，保持一下就好</span>';
}

function stamps(snapshot: PoseSnapshot) {
  return POSE_CHALLENGES.map((item, index) => '<div id="pose-stamp-' + index + '" class="pose-stamp" data-status="' + (snapshot.results[index]?.status ?? (index === snapshot.index ? 'current' : 'waiting')) + '"><span>' + (index + 1) + '</span><b>' + item.shortLabel + '</b><small>' + (snapshot.results[index]?.status === 'matched' ? '合拍成功' : snapshot.results[index] ? '勇敢尝试' : '等你来') + '</small></div>').join('');
}

export function poseGameView(snapshot: PoseSnapshot, gentle: boolean, demo: boolean) {
  return '<div class="game-header pose-game-header"><div class="game-title"><h1>默契模仿秀</h1><p>' + (snapshot.players.length === 2 ? '亲子合作' : '自己玩') + ' · ' + (gentle ? '小手模式' : '标准模式') + ' · ' + (demo ? '按钮演示 · 未使用摄像头' : '照着做，一起过关') + '</p></div><div class="scoreboard"><div class="score-value"><small>共同得分</small><strong id="score">0</strong></div><div class="score-value"><small>第几张</small><strong class="timer" id="pose-step">1 / 6</strong></div><button id="pause" class="button secondary pose-pause" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '歇一下</button></div></div>' +
    '<div class="pose-layout"><section id="pose-card" class="pose-card" data-target="' + snapshot.target + '">' + poseCard(snapshot.target) + '</section><section class="pose-stage-stack"><div class="pose-playfield"><canvas id="stage" aria-label="默契模仿秀镜像游戏区域"></canvas><span class="preview-badge">' + (demo ? '按钮演示 · 试试下方两位伙伴的按钮' : '镜像舞台 · 手上的光点跟着自己走') + '</span><div class="pose-clock"><b id="pose-time">' + (gentle ? '20' : '16') + '</b><span>秒慢慢来</span></div><div id="countdown" class="countdown-overlay"><p>看一看示范，准备好了吗？</p><strong id="countdown-number">3</strong><h2>准备好，一起摆！</h2></div><div id="pose-celebration" class="pose-celebration" hidden><span>' + icon('spark') + '</span><h2 id="pose-feedback">这一张，我们合拍啦！</h2><p id="pose-feedback-note">默契 +100</p></div><span id="tracking-hint" class="stage-hint"></span></div>' +
    '<div class="pose-players' + (demo ? ' pose-demo-players' : '') + '">' + snapshot.players.map((player, index) => '<div class="pose-player" id="pose-player-' + index + '" data-ready="false"><div class="pose-player-top"><span class="partner-dot"></span><b>伙伴 ' + (index + 1) + '</b><span id="pose-player-state-' + index + '">跟着卡片试试看</span></div><progress id="pose-progress-' + index + '" max="1" value="0" aria-label="伙伴' + (index + 1) + '保持进度"></progress>' + (demo ? '<button id="demo-pose-' + index + '" data-action="demo-pose-' + index + '" aria-pressed="false">模拟伙伴 ' + (index + 1) + ' 跟上</button>' : '') + '</div>').join('') + '</div></section></div>' +
    '<div class="pose-journey" aria-label="六张动作记录">' + stamps(snapshot) + '</div><div class="pose-bottom"><span>先完成，就等一等同伴。不着急，我们一起。</span><span>抬手指向「歇一下」停留，或按 <kbd>空格</kbd> 暂停</span></div>';
}

export function poseResultsView(snapshot: PoseSnapshot, demo: boolean) {
  return '<section class="results pose-results"><div class="pose-result-art">' + poseScene(Array.from({ length: snapshot.players.length }, () => 'star')) + '</div><span class="eyebrow">OUR LITTLE MOMENT</span><h1 id="results-title">' + (snapshot.completed ? '我们的默契，又多了一点。' : '一起试一试，就很了不起。') + '</h1><p>' + (demo ? '按钮演示结束 · ' : '') + '这一局，合拍完成了 ' + snapshot.completed + ' 张动作卡。</p><div class="result-card"><div><small>我们的共同得分</small><strong id="final-score">' + snapshot.score + '</strong></div><div><small>合拍动作</small><strong>' + snapshot.completed + '<small> / 6</small></strong></div><div><small>一起动了</small><strong>' + Math.round(snapshot.elapsedMs / 1000) + '<small> 秒</small></strong></div></div><div class="pose-result-stamps">' + stamps(snapshot) + '</div><div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再来一次合拍</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div><p class="result-note">给彼此一个击掌，喝口水。快乐不需要比谁更厉害。</p></section>';
}

export function poseHelpView() {
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">MAKE A POSE TOGETHER</span><h2>你来模仿，我来陪你。</h2><div class="help-list"><div><b>1</b><section><h3>照着大卡片，做个小动作</h3><p>六张动作卡，只动上半身。双脚站稳，给彼此留一点伸手空间。</p></section></div><div><b>2</b><section><h3>各自保持，一起过关</h3><p>进度条满了就完成。先完成的伙伴可以放松，等一等同伴。超时不扣分，下一张继续。</p></section></div><div><b>3</b><section><h3>想歇一下，指向暂停按钮</h3><p>抬手指向「歇一下」，停留 1 秒，或按空格。暂停后可以换个动作。重新站位会开始新一局。</p></section></div></div><button class="button primary full" data-action="close-modal">准备好，一起模仿</button>';
}

function text(id: string, value: string) {
  const element = document.getElementById(id);
  if (element && element.textContent !== value) element.textContent = value;
}

export function syncPoseView(snapshot: PoseSnapshot, active: boolean[], demo: boolean) {
  const card = document.getElementById('pose-card');
  if (card && card.dataset.target !== snapshot.target) { renderMarkup(card, poseCard(snapshot.target)); card.dataset.target = snapshot.target; }
  text('score', String(snapshot.score)); text('pose-step', (snapshot.index + 1) + ' / 6'); text('pose-time', String(Math.ceil(snapshot.remainingMs / 1000)));
  snapshot.players.forEach((player, index) => {
    const element = document.getElementById('pose-player-' + index);
    if (element) element.dataset.ready = String(player.ready);
    const progress = document.getElementById('pose-progress-' + index) as HTMLProgressElement | null;
    if (progress) progress.value = player.progress;
    text('pose-player-state-' + index, player.ready ? '完成啦，等一等同伴' : player.matched ? '就是这样，保持一下' : player.hint);
    const button = document.getElementById('demo-pose-' + index) as HTMLButtonElement | null;
    if (button) { button.setAttribute('aria-pressed', String(!!active[index])); button.disabled = snapshot.stage !== 'pose' || snapshot.phase !== 'playing'; }
  });
  POSE_CHALLENGES.forEach((_, index) => {
    const stamp = document.getElementById('pose-stamp-' + index);
    if (stamp) {
      const status = snapshot.results[index]?.status;
      stamp.dataset.status = status ?? (index === snapshot.index ? 'current' : 'waiting');
      const label = stamp.querySelector('small');
      const value = status === 'matched' ? '合拍成功' : status ? '勇敢尝试' : index === snapshot.index ? '就是这张' : '等你来';
      if (label && label.textContent !== value) label.textContent = value;
    }
  });
  const celebration = document.getElementById('pose-celebration');
  if (celebration) celebration.hidden = snapshot.stage !== 'celebrate';
  const matched = snapshot.results.at(-1)?.status === 'matched';
  text('pose-feedback', matched ? '这一张，我们合拍啦！' : '下一张，也很有趣。');
  text('pose-feedback-note', matched ? (demo ? '演示合拍 +100' : '默契 +100') : '不扣分，慢慢试就好');
}
