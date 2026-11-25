import { icon } from './icons.mjs';
import { spaceLabel, type SpaceMode } from './space-views.ts';
import type { Round } from '../game/round.ts';
import { gameArtCatalog, gameArtUrl, type TreasureArt, type GameArt } from '../art/catalog.ts';

function artImage(name: GameArt, decorative = false): string {
  return '<img src="' + gameArtUrl(name) + '" alt="' + (decorative ? '' : gameArtCatalog[name].label) + '" width="128" height="128" decoding="async">';
}

function treasureShelf(): string {
  return '<div class="treasure-shelf">' + (['slipper', 'handbag', 'dress', 'crown'] as TreasureArt[]).map(name => '<div class="treasure-card">' + artImage(name) + '<span>' + gameArtCatalog[name].label + '</span><b>+' + gameArtCatalog[name].points + '</b></div>').join('') + '</div>';
}

export function heartsTreasures(): string {
  return treasureShelf() + '<div class="costume-preview">' + artImage('bomb') + '<span>接到炸弹？<b>噗，变个可爱的脸！</b></span><div>' + artImage('donkey') + artImage('piglet') + '</div></div>';
}

export function heartsFeature(): string {
  return '<section class="feature-scene hearts-feature" aria-label="爱心雨游戏介绍"><div class="feature-heading"><small>A LITTLE FAIRYTALE, TOGETHER</small><h2>爱心雨 · 童话奇遇</h2></div>' +
    '<div class="round-stamp"><b>60</b><span>秒惊喜</span></div>' + heartsTreasures() +
    '<div class="scene-labels"><span>爱心与宝物一起接</span><span>三种搞怪变身</span><span>一人接，大家笑</span></div></section>';
}

export function heartsGameView(players: 1 | 2, gentle: boolean, demo: boolean, spaceMode: SpaceMode, round: Round): string {
  return '<div class="game-header"><div class="game-title"><h1>爱心雨</h1><p>' + (players === 2 ? '亲子合作' : '自己玩') + ' · ' + (gentle ? '小手模式' : '标准模式') + ' · ' + (demo ? '鼠标体验 · 未使用摄像头' : '接住童话宝物，躲开变身炸弹') + '</p><span id="space-badge" class="space-badge">' + spaceLabel(spaceMode) + '</span></div>' +
    '<div class="scoreboard"><div class="score-value"><small>爱心得分</small><strong id="score">' + round.score + '</strong></div><div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div><button id="pause" class="button secondary pose-pause" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '歇一下</button></div></div>' +
    '<div class="game-stage live-game hearts-stage"><canvas id="stage" aria-label="双手接爱心和童话宝物游戏区域" tabindex="0"></canvas><div id="countdown" class="countdown-overlay"><p>移动小篮接宝物，躲开冒火星的炸弹</p><strong id="countdown-number">3</strong><h2>童话宝物，从天而降！</h2></div><span id="tracking-hint" class="stage-hint"></span></div>' +
    '<div class="game-bottom"><span id="combo-label">接住爱心和童话宝物，小心炸弹让你变身！</span><div class="round-progress"><span id="time-progress"></span></div><span>' + (demo ? '移动鼠标接宝物 / ' : '指向「歇一下」/ ') + '<kbd>空格</kbd> 暂停</span></div>';
}

export function heartsResultsView(players: 1 | 2, round: Round, goldenCount: number, bombedCount: number, demo: boolean): string {
  const message = round.hits === 0 ? '伸伸小手，也很温暖。' : bombedCount === 0 ? '一颗炸弹都没中，反应太赞啦！' : (players === 2 ? '笑声和爱心，都被我们接住啦。' : '又接爱心又躲炸弹，太厉害啦！');
  const seconds = Math.floor((60000 - round.remainingMs) / 1000);
  return '<section class="results"><div class="results-illustration"><span class="medal">' + icon('spark') + '</span><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i></div>' +
    '<h1 id="results-title">' + message + '</h1><p>' + (demo ? '鼠标体验结束 · ' : '') + '共接住 ' + round.hits + ' 件爱心与宝物（金色惊喜 ' + goldenCount + ' 件），搞怪变身 ' + bombedCount + ' 次。</p>' +
    '<div class="result-card"><div><small>' + (players === 2 ? '我们的爱心总分' : '我的爱心得分') + '</small><strong id="final-score">' + round.score + '</strong></div><div><small>接住宝物</small><strong>' + round.hits + '</strong></div><div><small>最高连击</small><strong>' + round.bestCombo + '</strong></div></div>' +
    '<div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再玩一局爱心雨</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div>' +
    '<p class="result-note">这次开心动了 ' + seconds + ' 秒。变回自己，喝口水再来寻宝吧。</p></section>';
}

export function heartsHelpView(): string {
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">CATCH THE FALLING HEARTS</span><h2>接住童话宝物，遇见搞怪魔法。</h2><div class="help-list"><div><b>1</b><section><h3>肩宽小篮，灵活移动</h3><p>接物篮与你的肩宽相近，跟随双手中心左右移动。爱心和宝物会从画面上方飘落，原地移动双手接取，不用奔跑。</p></section></div><div><b>2</b><section><h3>接宝物得分，炸弹让你变个脸</h3><p>水晶鞋/包包 +10，公主裙 +20，皇冠 +30；粉心、大心、金心也继续出现。冒火星的炸弹扣 20 分（最低 0 分），随机变小黑脸、小驴或小猪，几秒后恢复。躲开不扣分。</p></section></div><div><b>3</b><section><h3>随时歇一歇</h3><p>游戏中可以放心高举双手。想暂停时，抬手指向右上角「歇一下」停留 1 秒或按空格键。</p></section></div></div><button class="button primary full" data-action="close-modal">准备好，接爱心啦</button>';
}
