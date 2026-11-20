import { icon } from './icons.mjs';
import { scene } from './scene.mjs';

export function homeView(state) {
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
    '<p class="under-button">现在可用鼠标试玩 <span>·</span> <button data-action="help">查看玩法</button></p></section>',
    '<section class="feature-scene" aria-label="泡泡派对游戏介绍"><div class="feature-heading"><small>WAVE, POP & LAUGH</small><h2>泡泡派对</h2></div>',
    '<div class="round-stamp"><b>60</b><span>秒快乐</span></div>' + scene(2),
    '<div class="feature-hint">啪！快乐 +10</div><div class="scene-labels"><span>原地挥手</span><span>亲子合作</span><span>漏掉也没关系</span></div></section></div>',
    '<section class="play-guide" aria-label="游玩提示">',
    '<div class="guide-item"><span class="guide-icon">' + icon('person') + '</span><div><h3>给小手，留一点空间</h3><p>伸开双手不碰到彼此，就刚刚好</p></div></div>',
    '<div class="guide-item"><span class="guide-icon">' + icon('spark') + '</span><div><h3>挥一挥，就有小惊喜</h3><p>不用跳跃，不用奔跑，轻松拍泡泡</p></div></div>',
    '<div class="guide-item"><span class="guide-icon">' + icon('duo') + '</span><div><h3>一起玩，就是好成绩</h3><p>只有共同得分，没有谁输谁赢</p></div></div></section>'
  ].join('');
}

function steps(active) {
  return '<div class="section-heading"><button class="back-button" data-action="home">' + icon('back') + '返回大厅</button><div class="steps" aria-label="准备进度">' +
    ['准备设备', '站好位置', '开心开玩'].map((text, index) => '<span class="' + (active === index ? 'current' : '') + '"><b>' + (index + 1) + '</b>' + text + '</span>').join('<i></i>') + '</div></div>';
}

function preview(players) {
  return '<div class="preview"><span class="preview-badge">' + icon('camera') + '模拟画面 · 不读取摄像头</span>' +
    scene(players) + '<div class="viewfinder"></div><div class="preview-bottom"><span>' +
    (players === 2 ? '大朋友' : '小玩家') + '</span>' + (players === 2 ? '<span>小朋友</span>' : '') + '</div></div>';
}

export function deviceView(state) {
  const issue = state.device !== 'ready';
  const message = state.device === 'missing' ? ['还没找到摄像头', '看看摄像头有没有插好。正式版本会在这里帮你检查连接。'] : ['需要允许使用摄像头', '正式版本中，请在浏览器里允许摄像头访问，然后再试一次。'];
  const view = issue
    ? '<div class="preview"><div id="device-error" class="error-preview">' + icon('camera') + '<span class="eyebrow">模拟异常状态</span><h2>' + message[0] + '</h2><p>' + message[1] + '</p><button id="retry-device" class="button secondary" data-action="retry">' + icon('reset') + '重试模拟检查</button></div></div>'
    : preview(state.players);
  return steps(0) + '<div class="setup-grid">' + view + '<section class="setup-copy"><span class="eyebrow">A LITTLE PREPARATION</span>' +
    '<h1 id="device-title">先准备好，<br>快乐的小舞台。</h1><p>把 PS4 体感摄像头放在电视附近，接到笔记本。<br>让大朋友和小朋友都能出现在画面里。</p>' +
    '<div class="checks"><div class="check-row"><span class="check-dot">' + icon(issue ? 'camera' : 'check') + '</span><div><b>' + (issue ? '等待设备就绪' : '示例画面已就绪') + '</b><small>索尼 PS4 体感摄像头 · PlayStation Camera</small></div></div>' +
    '<div class="check-row"><span class="check-dot">' + icon('duo') + '</span><div><b>' + (state.players === 2 ? '亲子合作 · 2 人' : '自己玩 · 1 人') + '</b><small>挥手时不碰到彼此，也不碰到家具</small></div></div></div>' +
    '<button id="device-next" class="button primary full" data-action="calibration"' + (issue ? ' disabled' : '') + '>下一步，站好位置' + icon('arrow') + '</button>' +
    '<div class="notice">' + icon('shield') + '原型使用模拟画面，PS4 体感摄像头状态尚未检测。正式连接方式：摄像头 → 笔记本 → HDMI 电视。</div>' +
    '<label class="simulation-control" for="device-state">原型状态演示<select id="device-state"><option value="ready">设备就绪（模拟）</option><option value="missing">摄像头未连接</option><option value="denied">摄像头未授权</option></select></label></section></div>';
}

export function calibrationView(state) {
  return steps(1) + '<div class="setup-grid"><div class="preview">' + scene(state.players) +
    '<span class="preview-badge">站位示意 · 非真实识别</span><div id="calibration-ring" class="calibration-ring"></div>' +
    '<div class="calibration-state"><span id="calibration-status">伸出小手，和泡泡打个招呼</span><progress id="calibration-progress" max="2000" value="0" aria-label="模拟校准进度"></progress></div></div>' +
    '<section class="setup-copy"><span class="eyebrow">HELLO, LITTLE HANDS</span><h1 id="calibration-title">站好啦？<br>和泡泡打个招呼。</h1>' +
    '<p id="players-label">' + (state.players === 2 ? '两个人，一起站好' : '一个人，也能快乐开玩') + '</p>' +
    '<ul class="tip-list"><li>' + icon('person') + '站在各自的位置，原地轻松挥手</li><li>' + icon('duo') + (state.players === 2 ? '大朋友站一边，小朋友站另一边' : '给小手留出不碰到家具的空间') + '</li><li>' + icon('spark') + '小手模式会把泡泡放得低一点</li></ul>' +
    '<button id="calibrate" class="button secondary full" data-action="calibrate">模拟举手 2 秒</button>' +
    '<button id="start-round" class="button primary full" data-action="start-round" disabled>准备好，开始吧' + icon('arrow') + '</button>' +
    '<p class="notice">真实版本将按每个人的身高校准。当前点击按钮，演示举手准备流程。</p></section></div>';
}

export function gameView(state) {
  return '<div class="game-header"><div class="game-title"><h1>泡泡派对</h1><p>' +
    (state.players === 2 ? '亲子合作' : '自己玩') + ' · ' + (state.gentle ? '小手模式' : '标准模式') + ' · 鼠标试玩</p></div>' +
    '<div class="scoreboard"><div class="score-value"><small>' + (state.players === 2 ? '一起得分' : '快乐得分') + '</small><strong id="score">0</strong></div>' +
    '<div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div>' +
    '<button id="pause" class="icon-button" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '</button></div></div>' +
    '<div class="game-stage">' + scene(state.players, false) + '<div class="game-floor"></div><div id="game-field" aria-label="移动鼠标或点击泡泡来得分"></div>' +
    '<div id="countdown" class="countdown-overlay"><p>小手准备好，快乐马上到</p><strong id="countdown-number" aria-live="polite">3</strong><h2>伸出手，一起拍！</h2><p>原型操作：鼠标碰到泡泡，或点击泡泡</p></div></div>' +
    '<div class="game-bottom"><span id="combo-label">挥挥鼠标，拍中第一个泡泡</span><div class="round-progress"><span id="time-progress"></span></div><span><kbd>空格</kbd> 暂停 · <kbd>Tab</kbd> 选择泡泡</span></div>';
}

export function resultsView(state) {
  const round = state.round;
  const message = round.hits === 0 ? '一起动一动，也很棒。' : (state.players === 2 ? '快乐，是一起完成的。' : '小小的你，能量满满。');
  const seconds = Math.floor((60000 - round.remainingMs) / 1000);
  return '<section class="results"><div class="results-illustration"><span class="medal">' + icon('spark') + '</span><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i><i class="confetti"></i></div>' +
    '<span class="eyebrow">LITTLE MOVES, BIG SMILES</span><h1 id="results-title">' + message + '</h1><p>刚刚，我们把 ' + round.hits + ' 个泡泡变成了快乐。</p>' +
    '<div class="result-card"><div><small>' + (state.players === 2 ? '我们的共同得分' : '我的快乐得分') + '</small><strong id="final-score">' + round.score + '</strong></div><div><small>拍中泡泡</small><strong>' + round.hits + '</strong></div><div><small>最高连击</small><strong>' + round.bestCombo + '</strong></div></div>' +
    '<div class="result-actions"><button id="again" class="button primary" data-action="again">' + icon('reset') + '再来一局</button><button id="back-home" class="button secondary" data-action="home">回到游戏大厅</button></div>' +
    '<p class="result-note">这次开心动了 ' + seconds + ' 秒。休息一下，喝口水，再出发。</p></section>';
}
