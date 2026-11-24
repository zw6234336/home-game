import { icon } from './icons.mjs';
import { spaceLabel, type SpaceMode } from './space-views.ts';
import type { Round } from '../game/round.ts';

function gatesIllustration(): string {
  return '<svg class="gates-art" viewBox="0 0 420 210" aria-hidden="true">' +
    '<rect x="18" y="16" width="384" height="178" rx="24" fill="#eef3fc" stroke="#b6c9ee" stroke-width="3"/>' +
    '<rect x="64" y="40" width="292" height="130" rx="18" fill="none" stroke="#99b3e8" stroke-width="2.5" stroke-dasharray="9 7"/>' +
    '<rect x="108" y="64" width="204" height="82" rx="14" fill="none" stroke="#80a1e0" stroke-width="2"/>' +
    '<rect x="64" y="40" width="144" height="130" rx="16" fill="#5cc4a2" fill-opacity="0.22" stroke="#48b28f" stroke-width="3"/>' +
    '<rect x="212" y="40" width="144" height="130" rx="16" fill="#eb746c" fill-opacity="0.24" stroke="#df645c" stroke-width="3"/>' +
    '<ellipse cx="210" cy="128" rx="64" ry="26" fill="none" stroke="#4da8d8" stroke-width="3" stroke-dasharray="8 6"/>' +
    '<polygon points="120,79 124,66 132,74 140,66 144,79" fill="#f6c858" stroke="#8c5a12" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<circle cx="132" cy="92" r="14" fill="#635194"/>' +
    '<rect x="116" y="110" width="32" height="36" rx="14" fill="#635194"/>' +
    '<polygon points="160,97 163,87 170,93 177,87 180,97" fill="#f6c858" stroke="#8c5a12" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="170" cy="108" r="11" fill="#e88766"/>' +
    '<rect x="158" y="122" width="24" height="26" rx="11" fill="#e88766"/>' +
    '<ellipse cx="274" cy="70" rx="7" ry="18" transform="rotate(-10 274 70)" fill="#f597bc" stroke="#87385a" stroke-width="2"/>' +
    '<ellipse cx="294" cy="70" rx="7" ry="18" transform="rotate(10 294 70)" fill="#f597bc" stroke="#87385a" stroke-width="2"/>' +
    '<ellipse cx="274" cy="71" rx="3.5" ry="11" transform="rotate(-10 274 71)" fill="#ffdce9"/>' +
    '<ellipse cx="294" cy="71" rx="3.5" ry="11" transform="rotate(10 294 71)" fill="#ffdce9"/>' +
    '<circle cx="284" cy="98" r="16" fill="#fbb9d3" stroke="#87385a" stroke-width="2"/>' +
    '<circle cx="278" cy="95" r="2.2" fill="#3a2136"/>' +
    '<circle cx="290" cy="95" r="2.2" fill="#3a2136"/>' +
    '<circle cx="284" cy="100" r="2.6" fill="#ea4b85"/>' +
    '<rect x="269" y="116" width="30" height="32" rx="14" fill="#f597bc" stroke="#87385a" stroke-width="2"/>' +
    '<polygon points="104,56 109,68 122,68 112,76 116,88 104,80 92,88 96,76 86,68 99,68" fill="#f6c858" stroke="#ffffff" stroke-width="2"/>' +
    '</svg>';
}

export function gatesFeature(): string {
  return '<section class="feature-scene gates-feature" aria-label="太空穿越门游戏介绍"><div class="feature-heading"><small>DODGE, STEP & SHINE TOGETHER</small><h2>太空穿越门 · 景深跑酷</h2></div>' +
    '<div class="round-stamp"><b>60</b><span>秒畅玩</span></div>' + gatesIllustration() +
    '<div class="feature-hint">安全区变公主 · 危险区变粉兔</div>' +
    '<div class="scene-labels"><span>安全区变身小公主</span><span>危险区变粉色毛兔</span><span>双目景深与护盾星</span></div></section>';
}

export function gatesGameView(players: 1 | 2, gentle: boolean, demo: boolean, spaceMode: SpaceMode, round: Round): string {
  return '<div class="game-header"><div class="game-title"><h1>太空穿越门</h1><p>' + (players === 2 ? '亲子合作' : '自己玩') + ' · ' + (gentle ? '小手模式' : '标准模式') + ' · ' + (demo ? '鼠标体验 · 未使用摄像头' : '跳进安全区变公主，留在危险区变粉色毛兔') + '</p><span id="space-badge" class="space-badge">' + spaceLabel(spaceMode) + '</span></div>' +
    '<div class="scoreboard"><div class="score-value"><small>穿越得分</small><strong id="score">' + round.score + '</strong></div><div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div><button id="pause" class="button secondary pose-pause" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '歇一下</button></div></div>' +
    '<div class="game-stage live-game gates-stage"><canvas id="stage" aria-label="太空穿越门体感游戏区域" tabindex="0"></canvas><div id="countdown" class="countdown-overlay"><p>跳进绿色安全区变身小公主，留在危险区就会变成粉色毛兔！</p><strong id="countdown-number">3</strong><h2>星门开启，准备出发！</h2></div><span id="tracking-hint" class="stage-hint"></span></div>' +
    '<div class="game-bottom"><span id="combo-label">太空起航 · 跟着星门指示动起来！</span><div class="round-progress"><span id="time-progress"></span></div><span>' + (demo ? '移动鼠标躲避，点击踩景深环 / ' : '指向「歇一下」/ ') + '<kbd>空格</kbd> 暂停</span></div>';
}

export function gatesResultsView(players: 1 | 2, round: Round, passed: number, rescues: number, demo: boolean): string {
  const message = passed === 0 ? '太空热身完毕，下次一定冲过去！' : rescues > 0 ? '默契护盾太暖了，合作大成功！' : (players === 2 ? '并肩穿越星海，你们太默契啦！' : '身手敏捷的太空探险家！');
  const seconds = Math.floor((60000 - round.remainingMs) / 1000);
  return '<section class="results"><div class="results-illustration"><span class="medal">' + icon('spark') + '</span><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i></div>' +
    '<h1 id="results-title">' + message + '</h1><p>' + (demo ? '鼠标体验结束 · ' : '') + '共成功穿越 ' + passed + ' 扇星门，同伴护盾救场 ' + rescues + ' 次。</p>' +
    '<div class="result-card"><div><small>' + (players === 2 ? '我们的星际总分' : '我的星际得分') + '</small><strong id="final-score">' + round.score + '</strong></div><div><small>成功穿门</small><strong>' + passed + '</strong></div><div><small>最高连击</small><strong>' + round.bestCombo + '</strong></div></div>' +
    '<div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再闯一次太空门</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div>' +
    '<p class="result-note">这次畅快运动了 ' + seconds + ' 秒。擦擦汗、喝口水，准备下一场冒险。</p></section>';
}

export function gatesHelpView(): string {
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">SPACE PORTAL RUN</span><h2>跑起来，蹲下去，一起变身穿星门。</h2><div class="help-list"><div><b>1</b><section><h3>安全区变公主，危险区变粉兔</h3><p>跳进绿色安全区立刻戴上皇冠变身小公主；若留在珊瑚色危险区，就会瞬间变成毛茸茸的粉色毛兔！遇到横杆一起下蹲，遇到双星拱门高举双手。</p></section></div><div><b>2</b><section><h3>双目景深前后星环</h3><p>中后段会出现前排与后排景深星环：往前跨一步或往后退一步即可踩亮过关。无双目镜头时自动按肩宽尺度判定。</p></section></div><div><b>3</b><section><h3>金色护盾星救场</h3><p>任一伙伴挥手拍亮空中的金色「护盾」星，就能为全队加上保护罩，在同伴差一点没躲开时挡住一次擦碰并保留连击。</p></section></div></div><button class="button primary full" data-action="close-modal">准备好，冲向星门</button>';
}
