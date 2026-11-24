import { icon } from './icons.mjs';
import { spaceLabel, type SpaceMode } from './space-views.ts';
import type { Round } from '../game/round.ts';

function bridgeIllustration(): string {
  return '<svg class="bridge-art" viewBox="0 0 420 210" aria-hidden="true">' +
    '<rect x="14" y="16" width="392" height="178" rx="24" fill="#f6f1fc" stroke="#d5c6ee" stroke-width="3"/>' +
    '<path d="M16 142 H82 V192 H16 Z" fill="#82c6ad" fill-opacity="0.34"/>' +
    '<line x1="16" y1="142" x2="82" y2="142" stroke="#48a686" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M338 142 H404 V192 H338 Z" fill="#a692e0" fill-opacity="0.34"/>' +
    '<line x1="338" y1="142" x2="404" y2="142" stroke="#8066c6" stroke-width="4" stroke-linecap="round"/>' +
    '<rect x="352" y="102" width="38" height="40" rx="6" fill="#fffaf0" stroke="#977ed1" stroke-width="2.5"/>' +
    '<polygon points="348,104 371,78 394,104" fill="#f28b82"/>' +
    '<path d="M84 128 Q210 92 336 128" fill="none" stroke="#f28b82" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M84 133 Q210 97 336 133" fill="none" stroke="#f6c858" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M84 138 Q210 102 336 138" fill="none" stroke="#58c7a3" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M84 143 Q210 107 336 143" fill="none" stroke="#7ea8e8" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="145" cy="148" r="11" fill="#635194"/>' +
    '<circle cx="268" cy="154" r="9" fill="#e88766"/>' +
    '<circle cx="210" cy="92" r="14" fill="#65c9a8" stroke="#ffffff" stroke-width="3"/>' +
    '<circle cx="205" cy="90" r="2" fill="#2d243b"/>' +
    '<circle cx="215" cy="90" r="2" fill="#2d243b"/>' +
    '<polygon points="274,46 278,56 289,56 280,62 283,72 274,66 265,72 268,62 259,56 270,56" fill="#f6c858" stroke="#ffffff" stroke-width="2"/>' +
    '<ellipse cx="140" cy="52" rx="34" ry="15" fill="#7c759e" fill-opacity="0.82"/>' +
    '<polygon points="142,60 134,76 141,76 136,88 150,70 143,70" fill="#f6c858"/>' +
    '</svg>';
}

export function bridgeFeature(): string {
  return '<section class="feature-scene bridge-feature" aria-label="彩虹能量桥游戏介绍"><div class="feature-heading"><small>LINK ARMS, ESCORT & DUCK</small><h2>彩虹能量桥 · 合作护送</h2></div>' +
    '<div class="round-stamp"><b>60</b><span>秒护送</span></div>' + bridgeIllustration() +
    '<div class="feature-hint">默契连桥 +50</div>' +
    '<div class="scene-labels"><span>伸臂搭彩虹桥</span><span>遇雷云一起下蹲</span><span>景深顺风加速</span></div></section>';
}

export function bridgeGameView(players: 1 | 2, gentle: boolean, demo: boolean, spaceMode: SpaceMode, round: Round): string {
  return '<div class="game-header"><div class="game-title"><h1>彩虹能量桥</h1><p>' + (players === 2 ? '亲子合作' : '自己玩') + ' · ' + (gentle ? '小手模式' : '标准模式') + ' · ' + (demo ? '鼠标体验 · 未使用摄像头' : '伸出双臂搭桥护送，遇雷云一起下蹲') + '</p><span id="space-badge" class="space-badge">' + spaceLabel(spaceMode) + '</span></div>' +
    '<div class="scoreboard"><div class="score-value"><small>彩虹得分</small><strong id="score">' + round.score + '</strong></div><div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div><button id="pause" class="button secondary pose-pause" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '歇一下</button></div></div>' +
    '<div class="game-stage live-game bridge-stage"><canvas id="stage" aria-label="彩虹能量桥体感游戏区域" tabindex="0"></canvas><div id="countdown" class="countdown-overlay"><p>伸开双手搭成彩虹桥，帮小精灵从左走到城堡</p><strong id="countdown-number">3</strong><h2>彩虹能量桥，接通！</h2></div><span id="tracking-hint" class="stage-hint"></span></div>' +
    '<div class="game-bottom"><span id="combo-label">伸展双臂搭起彩虹桥，把小精灵送到云朵城堡！</span><div class="round-progress"><span id="time-progress"></span></div><span>' + (demo ? '拖动鼠标搭桥，移到底部下蹲 / ' : '指向「歇一下」/ ') + '<kbd>空格</kbd> 暂停</span></div>';
}

export function bridgeResultsView(players: 1 | 2, round: Round, escorted: number, dodged: number, demo: boolean): string {
  const message = escorted === 0 ? '彩虹刚刚铺好，下一局一起冲过峡谷！' : dodged > 0 ? '既会连桥又会避雷，默契满分！' : (players === 2 ? '并肩搭起的彩虹桥，把快乐送进城堡啦！' : '稳稳护送小精灵的彩虹守护者！');
  const seconds = Math.floor((60000 - round.remainingMs) / 1000);
  return '<section class="results"><div class="results-illustration"><span class="medal">' + icon('spark') + '</span><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i></div>' +
    '<h1 id="results-title">' + message + '</h1><p>' + (demo ? '鼠标体验结束 · ' : '') + '共护送 ' + escorted + ' 只小精灵抵达城堡，全员避开雷云 ' + dodged + ' 次。</p>' +
    '<div class="result-card"><div><small>' + (players === 2 ? '我们的彩虹总分' : '我的彩虹得分') + '</small><strong id="final-score">' + round.score + '</strong></div><div><small>护送精灵</small><strong>' + escorted + '</strong></div><div><small>最高连击</small><strong>' + round.bestCombo + '</strong></div></div>' +
    '<div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再搭一次彩虹桥</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div>' +
    '<p class="result-note">这次伸展配合了 ' + seconds + ' 秒。活动一下肩膀、喝口水，准备下一场冒险。</p></section>';
}

export function bridgeHelpView(): string {
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">RAINBOW ENERGY BRIDGE</span><h2>伸出手臂，连成一条发光彩虹桥。</h2><div class="help-list"><div><b>1</b><section><h3>伸展双臂搭桥，彼此靠近连桥</h3><p>每位玩家的左手、肩膀和右手会连成发光彩虹桥；两人伸手靠近时会自动擦出「默契连桥」，利用身高差搭出斜坡带小精灵过峡谷。</p></section></div><div><b>2</b><section><h3>护送小精灵与摘高空星星</h3><p>普通小精灵 +40、金色皇冠精灵 +60、通过默契连桥再 +10；桥断开时小精灵会撑起泡泡降落伞慢飘，快跨步接回。托起彩虹摘高空星星 +20，往前微跨还能开启景深顺风加速。</p></section></div><div><b>3</b><section><h3>小雷云来时一起下蹲</h3><p>看到头顶出现雷云倒计时，大朋友和小朋友一起下蹲躲避（+30），被挠痒痒不扣分。想暂停可指向「歇一下」或按空格键。</p></section></div></div><button class="button primary full" data-action="close-modal">准备好，点亮彩虹桥</button>';
}
