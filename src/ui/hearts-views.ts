import { icon } from './icons.mjs';
import { spaceLabel, type SpaceMode } from './space-views.ts';
import type { Round } from '../game/round.ts';

function heartsIllustration(): string {
  return '<svg class="scene-art" viewBox="0 0 640 360" fill="none" aria-hidden="true">' +
    '<circle cx="150" cy="86" r="48" fill="#ffe7ee" opacity=".7"/>' +
    '<circle cx="490" cy="78" r="56" fill="#fff2cf" opacity=".75"/>' +
    '<path d="M180 68c0-14 18-22 28-10 10-12 28-4 28 10 0 18-28 34-28 34s-28-16-28-34Z" fill="#f47d5b" stroke="#302744" stroke-width="3.5"/>' +
    '<path d="M312 36c0-18 22-28 34-12 12-16 34-6 34 12 0 22-34 42-34 42s-34-20-34-42Z" fill="#f5c84c" stroke="#302744" stroke-width="3.5"/>' +
    '<path d="M440 74c0-15 19-23 30-11 11-12 30-4 30 11 0 19-30 36-30 36s-30-17-30-36Z" fill="#b7a4ed" stroke="#302744" stroke-width="3.5"/>' +
    '<path d="M250 132c0-12 15-19 24-8 9-11 24-4 24 8 0 15-24 28-24 28s-24-13-24-28Z" fill="#f2849e" stroke="#302744" stroke-width="3"/>' +
    '<path d="M392 140c0-12 15-19 24-8 9-11 24-4 24 8 0 15-24 28-24 28s-24-13-24-28Z" fill="#69bda5" stroke="#302744" stroke-width="3"/>' +
    '<circle cx="220" cy="222" r="28" fill="#fff9f4" stroke="#302744" stroke-width="4"/>' +
    '<path d="M168 326c8-48 24-70 52-70s44 22 52 70" fill="#b7a4ed" stroke="#302744" stroke-width="4"/>' +
    '<path d="M188 264c-18-16-28-36-26-54M252 264c18-16 28-36 26-54" stroke="#302744" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M162 210q58 34 116 0" stroke="#5ba991" stroke-width="9" stroke-linecap="round" fill="none"/>' +
    '<path d="M162 210q58 34 116 0" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '<circle cx="426" cy="242" r="24" fill="#fff9f4" stroke="#302744" stroke-width="4"/>' +
    '<path d="M382 326c7-38 20-56 44-56s37 18 44 56" fill="#f49a7d" stroke="#302744" stroke-width="4"/>' +
    '<path d="M398 278c-16-14-24-32-22-48M454 278c16-14 24-32 22-48" stroke="#302744" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M376 230q50 30 100 0" stroke="#f47d5b" stroke-width="9" stroke-linecap="round" fill="none"/>' +
    '<path d="M376 230q50 30 100 0" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '</svg>';
}

export function heartsFeature(): string {
  return '<section class="feature-scene hearts-feature" aria-label="爱心雨游戏介绍"><div class="feature-heading"><small>CATCH THE FALLING HEARTS</small><h2>爱心雨</h2></div>' +
    '<div class="round-stamp"><b>60</b><span>秒挑战</span></div>' + heartsIllustration() +
    '<div class="feature-hint">接金心 +30 · 躲炸弹！</div><div class="scene-labels"><span>肩宽小篮</span><span>全屏宽幅下落</span><span>小心炸弹变黑脸</span></div></section>';
}

export function heartsGameView(players: 1 | 2, gentle: boolean, demo: boolean, spaceMode: SpaceMode, round: Round): string {
  return '<div class="game-header"><div class="game-title"><h1>爱心雨</h1><p>' + (players === 2 ? '亲子合作' : '自己玩') + ' · ' + (gentle ? '小手模式' : '标准模式') + ' · ' + (demo ? '鼠标体验 · 未使用摄像头' : '接住爱心，躲开炸弹') + '</p><span id="space-badge" class="space-badge">' + spaceLabel(spaceMode) + '</span></div>' +
    '<div class="scoreboard"><div class="score-value"><small>爱心得分</small><strong id="score">' + round.score + '</strong></div><div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div><button id="pause" class="button secondary pose-pause" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '歇一下</button></div></div>' +
    '<div class="game-stage live-game hearts-stage"><canvas id="stage" aria-label="双手接爱心躲炸弹游戏区域" tabindex="0"></canvas><div id="countdown" class="countdown-overlay"><p>用肩宽小篮左右接爱心，躲开黑炸弹</p><strong id="countdown-number">3</strong><h2>准备接住满天爱心！</h2></div><span id="tracking-hint" class="stage-hint"></span></div>' +
    '<div class="game-bottom"><span id="combo-label">移动肩宽小篮接爱心，小心炸弹变小黑脸！</span><div class="round-progress"><span id="time-progress"></span></div><span>' + (demo ? '移动鼠标接爱心 / ' : '指向「歇一下」/ ') + '<kbd>空格</kbd> 暂停</span></div>';
}

export function heartsResultsView(players: 1 | 2, round: Round, goldenCount: number, bombedCount: number, demo: boolean): string {
  const message = round.hits === 0 ? '伸伸小手，也很温暖。' : bombedCount === 0 ? '一颗炸弹都没中，反应太赞啦！' : (players === 2 ? '笑声和爱心，都被我们接住啦。' : '又接爱心又躲炸弹，太厉害啦！');
  const seconds = Math.floor((60000 - round.remainingMs) / 1000);
  return '<section class="results"><div class="results-illustration"><span class="medal">' + icon('spark') + '</span><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i></div>' +
    '<h1 id="results-title">' + message + '</h1><p>' + (demo ? '鼠标体验结束 · ' : '') + '共接住 ' + round.hits + ' 颗爱心（金色惊喜 ' + goldenCount + ' 颗），变小黑脸 ' + bombedCount + ' 次。</p>' +
    '<div class="result-card"><div><small>' + (players === 2 ? '我们的爱心总分' : '我的爱心得分') + '</small><strong id="final-score">' + round.score + '</strong></div><div><small>接住爱心</small><strong>' + round.hits + '</strong></div><div><small>最高连击</small><strong>' + round.bestCombo + '</strong></div></div>' +
    '<div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再玩一局爱心雨</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div>' +
    '<p class="result-note">这次开心动了 ' + seconds + ' 秒。擦擦小黑脸，喝口水再来挑战吧。</p></section>';
}

export function heartsHelpView(): string {
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">CATCH THE FALLING HEARTS</span><h2>接住满天爱心，躲开小炸弹。</h2><div class="help-list"><div><b>1</b><section><h3>肩宽小篮，灵活移动</h3><p>接物篮与你的肩宽相近，跟随双手中心左右移动。爱心和炸弹会从整个画面宽幅飘落，需要灵活接取和闪避。</p></section></div><div><b>2</b><section><h3>接爱心得分，接炸弹变小黑脸</h3><p>粉心 +10、大心 +20、金心 +30；接到冒火星的黑炸弹会扣 20 分（最低 0 分）并把脸炸黑几秒，躲开炸弹不扣分。</p></section></div><div><b>3</b><section><h3>随时歇一歇</h3><p>游戏中可以放心高举双手。想暂停时，抬手指向右上角「歇一下」停留 1 秒或按空格键。</p></section></div></div><button class="button primary full" data-action="close-modal">准备好，接爱心啦</button>';
}
