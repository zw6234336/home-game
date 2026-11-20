import { icon } from './icons.mjs';
import { scene } from './scene.mjs';
import type { Round } from '../game/round.ts';
import type { Quality } from '../types.ts';

export type ViewState = { players: 1 | 2; gentle: boolean; quality: Quality; round: Round; mode: 'live' | 'demo'; fine: boolean };

export function homeView(state: ViewState) {
  return [
    '<div class="home-grid"><section class="welcome">',
    '<span class="eyebrow">' + icon('spark') + '把客厅，变成游乐场</span>',
    '<h1 id="home-title">今天，<br><span>一起动起来。</span></h1>',
    '<p class="lead">大手牵小手，把泡泡拍成快乐。<br>不用手柄，挥挥手就能一起玩。</p>',
    '<p class="mode-caption">今天和谁一起玩？</p><div class="mode-switch" role="group" aria-label="选择游玩人数">',
    '<button id="mode-solo" class="mode" data-action="solo" aria-pressed="' + (state.players === 1) + '">' + icon('person') + '<span><b>自己玩</b><small>一个人的小挑战</small></span></button>',
    '<button id="mode-duo" class="mode" data-action="duo" aria-pressed="' + (state.players === 2) + '">' + icon('duo') + '<span><b>亲子合作</b><small>快乐一起加倍</small></span></button></div>',
    '<button id="gentle-mode" class="gentle-toggle" role="switch" aria-checked="' + state.gentle + '" data-action="gentle"><span class="toggle-track"><i></i></span><span><b>小手模式</b><small>泡泡大一点，节奏慢一点</small></span></button>',
    '<button id="start" class="button primary start-button" data-action="prepare">准备开玩' + icon('arrow') + '</button>',
    '<p class="under-button"><button id="demo-start" data-action="demo">先用鼠标体验</button> <span>·</span> <button data-action="help">查看玩法</button></p></section>',
    '<section class="feature-scene" aria-label="泡泡派对游戏介绍"><div class="feature-heading"><small>WAVE, POP & LAUGH</small><h2>泡泡派对</h2></div>',
    '<div class="round-stamp"><b>60</b><span>秒快乐</span></div>' + scene(2),
    '<div class="feature-hint">啪！快乐 +10</div><div class="scene-labels"><span>原地挥手</span><span>亲子合作</span><span>漏掉也没关系</span></div></section></div>',
    '<section class="play-guide" aria-label="游玩提示">',
    '<div class="guide-item"><span class="guide-icon">' + icon('person') + '</span><div><h3>给小手，留一点空间</h3><p>伸开双手不碰到彼此，就刚刚好</p></div></div>',
    '<div class="guide-item"><span class="guide-icon">' + icon('spark') + '</span><div><h3>挥一挥，就有小惊喜</h3><p>不用跳跃，不用奔跑，轻松拍泡泡</p></div></div>',
    '<div class="guide-item"><span class="guide-icon">' + icon('duo') + '</span><div><h3>一起玩，就是好成绩</h3><p>只有共同得分，没有谁输谁赢</p></div></div></section>'
  ].join('');
}

export function resultsView(state: ViewState) {
  const round = state.round;
  const message = round.hits === 0 ? '一起动一动，也很棒。' : (state.players === 2 ? '快乐，是一起完成的。' : '小小的你，能量满满。');
  const seconds = Math.floor((60000 - round.remainingMs) / 1000);
  return '<section class="results"><div class="results-illustration"><span class="medal">' + icon('spark') + '</span><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i></div>' +
    '<h1 id="results-title">' + message + '</h1><p>刚刚，我们把 ' + round.hits + ' 个泡泡变成了快乐。</p>' +
    '<div class="result-card"><div><small>' + (state.players === 2 ? '我们的共同得分' : '我的快乐得分') + '</small><strong id="final-score">' + round.score + '</strong></div><div><small>拍中泡泡</small><strong>' + round.hits + '</strong></div><div><small>最高连击</small><strong>' + round.bestCombo + '</strong></div></div>' +
    '<div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再来一局</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div>' +
    '<p class="result-note">这次开心动了 ' + seconds + ' 秒。休息一下，喝口水，再出发。</p></section>';
}

export function escapeHtml(value: string) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)); }

function back() { return '<div class="section-heading"><button class="back-button" data-action="home">' + icon('back') + '返回大厅</button><span class="eyebrow">把客厅，变成游乐场</span></div>'; }

export function deviceView(state: ViewState) {
  return back() + '<div class="device-grid"><section><div class="live-preview"><canvas id="stage" aria-label="摄像头单眼镜像预览"></canvas><span class="preview-badge" id="preview-label">等待摄像头</span><div id="camera-placeholder">' + icon('camera') + '<h2>给快乐，一个镜头。</h2><p>接好 PS4 体感摄像头，允许浏览器使用。</p></div></div><div class="crop-panel"><span>单眼裁剪</span>' +
    ['x', 'y', 'width', 'height'].map((key, index) => '<label>' + ['左边', '顶部', '宽度', '高度'][index] + '<input id="crop-' + key + '" type="number" min="' + (index > 1 ? 1 : 0) + '" max="100" step="0.1" value="' + (index > 1 ? 100 : 0) + '" aria-label="裁剪' + key + '百分比">%</label>').join('') +
    '<button class="button secondary" data-action="crop">应用</button></div><p class="crop-help">画面只应出现一份人物。若是双目或带黑边，请按实际画面调整裁剪。</p></section><section class="setup-copy"><span class="eyebrow">READY WHEN YOU ARE</span><h1 id="device-title">先准备好，<br>快乐的小舞台。</h1><p>把摄像头放在电视附近，让大朋友和小朋友都入镜。</p><label class="setting-row">摄像头<select id="camera-select" aria-label="选择摄像头"><option value="">连接后选择设备</option></select></label><div id="device-status" role="status">等待连接</div><div class="device-actions"><button id="connect-camera" class="button secondary full" data-action="connect">连接摄像头</button><button id="confirm-crop" class="button primary full" data-action="confirm-crop" disabled>画面确认，启动识别</button><button id="device-next" class="button primary full" data-action="calibration" hidden>下一步，站好位置</button></div>' + qualityControls(state) + '<p class="notice">只在本机处理画面，不录像，不上传。第一次摄像头授权需要大朋友帮忙点击。</p></section></div>';
}

export function qualityControls(state: ViewState) {
  return '<label class="setting-row">识别质量<select id="quality-select"><option value="quality"' + (state.quality === 'quality' ? ' selected' : '') + '>高质量 · Full</option><option value="balanced"' + (state.quality === 'balanced' ? ' selected' : '') + '>均衡 · Lite</option><option value="fast"' + (state.quality === 'fast' ? ' selected' : '') + '>流畅 · Lite</option></select></label><label class="setting-row"><span>游戏精细手部增强<small>菜单始终优先精细识别</small></span><input id="fine-hands" type="checkbox"' + (state.fine ? ' checked' : '') + '></label>';
}

export function calibrationView(state: ViewState) {
  const demo = state.mode === 'demo';
  return back() + '<div class="setup-grid"><div class="live-preview calibration-preview"><canvas id="stage" aria-label="玩家校准预览"></canvas><span class="preview-badge">' + (demo ? '鼠标体验 · 未使用摄像头' : '镜像画面 · 举手打个招呼') + '</span><div class="standing-zones">' + (state.players === 2 ? '<span>大朋友的位置</span><span>小朋友的位置</span>' : '<span>你的小舞台</span>') + '</div><div class="calibration-state"><span id="calibration-status">' + (demo ? '体验模式，点击模拟站好' : '每人举起一只手，保持 2 秒') + '</span><progress id="calibration-progress" max="' + state.players + '" value="0"></progress></div></div><section class="setup-copy"><span class="eyebrow">HELLO, LITTLE HANDS</span><h1 id="calibration-title">站好啦？<br>和泡泡打个招呼。</h1><ul class="tip-list"><li>' + icon('person') + '两脚站稳，不用跳跃</li><li>' + icon('duo') + '伸开双手，给彼此留一点空间</li><li>' + icon('spark') + '举手 2 秒，再轻松伸伸手</li></ul><p>泡泡会出现在每个人的伸手范围内。<br>手上的光点，应该跟着自己移动。</p>' + (demo ? '<button id="calibrate" class="button secondary full" data-action="calibrate">模拟站好 2 秒</button>' : '') + '<button id="start-round" class="button primary full" data-action="start-round" disabled>准备好，开始吧' + icon('arrow') + '</button><p class="notice">抬手指向按钮，停留 1 秒选中。游戏中双手举起 1.5 秒可暂停。</p></section></div>';
}

export function gameView(state: ViewState) {
  return '<div class="game-header"><div class="game-title"><h1>泡泡派对</h1><p>' + (state.players === 2 ? '亲子合作' : '自己玩') + ' · ' + (state.gentle ? '小手模式' : '标准模式') + ' · ' + (state.mode === 'demo' ? '鼠标体验 · 未使用摄像头' : '挥手拍泡泡') + '</p></div><div class="scoreboard"><div class="score-value"><small>快乐得分</small><strong id="score">' + state.round.score + '</strong></div><div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div><button id="pause" class="icon-button" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '</button></div></div><div class="game-stage live-game"><canvas id="stage" aria-label="挥手拍泡泡游戏区域" tabindex="0"></canvas><div id="countdown" class="countdown-overlay"><p>小手准备好，快乐马上到</p><strong id="countdown-number">3</strong><h2>伸出手，一起拍！</h2></div><span id="tracking-hint" class="stage-hint"></span></div><div class="game-bottom"><span id="combo-label">拍到泡泡，快乐 +10</span><div class="round-progress"><span id="time-progress"></span></div><span>' + (state.mode === 'demo' ? '移动鼠标拍泡泡 / ' : '双手举起 1.5 秒 / ') + '<kbd>空格</kbd> 暂停</span></div>';
}

export function helpView() {
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">HOW TO PLAY</span><h2>不用学，放开玩。</h2><div class="help-list"><div><b>1</b><section><h3>原地挥手</h3><p>碰到泡泡就得分。一起合作，漏掉也没关系。</p></section></div><div><b>2</b><section><h3>抬手，指向，停一停</h3><p>菜单上停留 1 秒，圆环转满就选中。放下手再选下一项。</p></section></div><div><b>3</b><section><h3>随时歇一歇</h3><p>双手举起 1.5 秒，或按空格暂停。每局后喝口水，休息一下。</p></section></div></div><button class="button primary full" data-action="close-modal">知道了</button>';
}
