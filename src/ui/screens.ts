import { icon } from './icons.mjs';
import { adventureFeature } from './adventure-views.ts';
import type { Round } from '../game/round.ts';
import type { Quality } from '../types.ts';
import type { PoseSnapshot } from '../game/pose-session.ts';
import type { SpaceMode, SpacePreference } from '../game/space.ts';
import { spaceControls, spaceLabel } from './space-views.ts';
import { gameChoices, poseGameView, poseResultsView, poseHelpView } from './pose-views.ts';
import { heartsGameView, heartsResultsView, heartsHelpView } from './hearts-views.ts';
import { gatesGameView, gatesResultsView, gatesHelpView } from './gates-views.ts';
import { bridgeGameView, bridgeResultsView, bridgeHelpView } from './bridge-views.ts';

export type GameKind = 'bubbles' | 'poses' | 'hearts' | 'gates' | 'bridge';
export type ViewState = { players: 1 | 2; gentle: boolean; quality: Quality; round: Round; goldenHearts: number; bombedCount: number; gatesPassed: number; gatesRescues: number; bridgeEscorted: number; bridgeDodged: number; mode: 'live' | 'demo'; fine: boolean; freeMotion: boolean; game: GameKind; pose: PoseSnapshot | null; spacePreference: SpacePreference; spaceMode: SpaceMode };

export function homeView(state: ViewState) {
  return [
    '<div class="home-grid"><section class="welcome">',
    '<span class="eyebrow">' + icon('spark') + '把客厅，变成游乐场</span>',
    '<h1 id="home-title">今天，<br><span>一起动起来。</span></h1>',
    '<p class="lead">' + (state.game === 'poses' ? '你是一架小飞机，我是你的大翅膀。<br>照着动作卡，一起变成最默契的搭档。' : state.game === 'hearts' ? '水晶鞋、公主裙和皇冠，从童话里落下来。<br>接住惊喜，小心炸弹把你变成小猪。' : state.game === 'gates' ? '跳进安全区变身小公主，留在危险区就会变成粉色毛兔！<br>下蹲、滑步、前跨后退穿星门，拍亮护盾星还能替同伴挡擦碰。' : state.game === 'bridge' ? '伸出双臂搭起发光彩虹桥，护送小精灵过峡谷。<br>双人靠近自动连桥，看到小雷云就一起蹲下。' : '大手牵小手，把泡泡拍成快乐。<br>不用手柄，挥挥手就能一起玩。') + '</p>',
    '<p class="mode-caption">今天和谁一起玩？</p><div class="mode-switch" role="group" aria-label="选择游玩人数">',
    '<button id="mode-solo" class="mode" data-action="solo" aria-pressed="' + (state.players === 1) + '">' + icon('person') + '<span><b>自己玩</b><small>一个人的小挑战</small></span></button>',
    '<button id="mode-duo" class="mode" data-action="duo" aria-pressed="' + (state.players === 2) + '">' + icon('duo') + '<span><b>亲子合作</b><small>快乐一起加倍</small></span></button></div>',
    '<button id="gentle-mode" class="gentle-toggle" role="switch" aria-checked="' + state.gentle + '" data-action="gentle"><span class="toggle-track"><i></i></span><span><b>小手模式</b><small>' + (state.game === 'poses' ? '动作宽松一点，保持短一点' : state.game === 'hearts' ? '宝物大一点，下落更柔和' : state.game === 'gates' ? '星门慢一点，下蹲和跨步更轻松' : state.game === 'bridge' ? '连桥距离更宽，小精灵走得更稳' : '泡泡大一点，节奏慢一点') + '</small></span></button>',
    '<button id="start" class="button primary start-button" data-action="prepare">准备开玩' + icon('arrow') + '</button>',
    '<p class="under-button"><button id="demo-start" data-action="demo">' + (state.game === 'poses' ? '先用按钮体验' : '先用鼠标体验') + '</button> <span>·</span> <button data-action="help">查看玩法</button><button id="camera-settings" data-action="device-settings" hidden>镜头设置</button></p></section>',
    '<div class="game-library">' + adventureFeature(state.game) + gameChoices(state.game) + spaceControls(state.spacePreference) + '</div></div>',
    '<section class="play-guide" aria-label="游玩提示">',
    '<div class="guide-item"><span class="guide-icon">' + icon('person') + '</span><div><h3>给小手，留一点空间</h3><p>小客厅也能玩，手肘靠近身体就好</p></div></div>',
    '<div class="guide-item"><span class="guide-icon">' + icon('spark') + '</span><div><h3>' + (state.game === 'poses' ? '摆一摆，我们真合拍' : state.game === 'hearts' ? '伸出手，接住满天爱' : state.game === 'gates' ? '跑一跑，蹲一蹲，真痛快' : state.game === 'bridge' ? '连成桥，送精灵去城堡' : '挥一挥，就有小惊喜') + '</h3><p>' + (state.game === 'gates' ? '下蹲、左右滑步、前后跨步，一起动起来' : state.game === 'bridge' ? '伸展双臂、彼此靠近连桥，遇到雷云一起蹲' : '不用跳跃，不用奔跑，原地就能玩') + '</p></div></div>',
    '<div class="guide-item"><span class="guide-icon">' + icon('duo') + '</span><div><h3>一起玩，就是好成绩</h3><p>只有共同得分，没有谁输谁赢</p></div></div></section>'
  ].join('');
}

export function resultsView(state: ViewState) {
  if (state.game === 'poses' && state.pose) return poseResultsView(state.pose, state.mode === 'demo');
  if (state.game === 'hearts') return heartsResultsView(state.players, state.round, state.goldenHearts, state.bombedCount, state.mode === 'demo');
  if (state.game === 'gates') return gatesResultsView(state.players, state.round, state.gatesPassed, state.gatesRescues, state.mode === 'demo');
  if (state.game === 'bridge') return bridgeResultsView(state.players, state.round, state.bridgeEscorted, state.bridgeDodged, state.mode === 'demo');
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
  return back() + '<div class="device-grid"><section><div class="live-preview"><canvas id="stage" aria-label="摄像头单眼镜像预览"></canvas><span class="preview-badge" id="preview-label">等待摄像头</span><div id="camera-placeholder">' + icon('camera') + '<h2>给快乐，一个镜头。</h2><p>接好摄像头，允许后自动开启体感菜单。</p></div></div><div class="crop-panel"><span>单眼裁剪</span>' +
    ['x', 'y', 'width', 'height'].map((key, index) => '<label>' + ['左边', '顶部', '宽度', '高度'][index] + '<input id="crop-' + key + '" type="number" min="' + (index > 1 ? 1 : 0) + '" max="100" step="0.1" value="' + (index > 1 ? 100 : 0) + '" aria-label="裁剪' + key + '百分比">%</label>').join('') +
    '<button class="button secondary" data-action="crop">应用</button></div><div class="crop-presets" role="group" aria-label="快捷单眼预设"><button id="crop-preset-left" class="button secondary" data-action="crop-left">左单眼</button><button id="crop-preset-near" class="button secondary" data-action="crop-left-near">单眼拉近</button><button id="crop-preset-right" class="button secondary" data-action="crop-right">右单眼</button><button id="crop-preset-full" class="button quiet" data-action="crop-full">全画面</button></div><p class="crop-help">画面只应出现一份人物。PS4 双目原生含左右两镜头与右侧多尺度条纹，已支持自动或一键裁出单眼。</p></section><section class="setup-copy"><span class="eyebrow">READY WHEN YOU ARE</span><h1 id="device-title">先准备好，<br>快乐的小舞台。</h1><p>把摄像头放在电视附近，让大朋友和小朋友都入镜。</p><label class="setting-row">摄像头<select id="camera-select" aria-label="选择摄像头"><option value="">连接后选择设备</option></select></label><div id="device-status" role="status">等待连接</div><div class="device-actions"><button id="connect-camera" class="button secondary full" data-action="connect">连接摄像头</button><button id="confirm-crop" class="button primary full" data-action="confirm-crop" disabled>重新启动体感菜单</button><button id="device-next" class="button primary full" data-action="calibration" hidden>下一步，打个招呼</button></div>' + qualityControls(state) + '<p class="notice">第一次授权请大朋友点击，先举一只手到肩膀上方保持2秒绑定游玩伙伴，旁观者放松双手。双人由屏幕右侧伙伴主控菜单；侧伸手臂切换、胸前合掌确认、交叉搭肩返回。画面只在本机处理。</p></section></div>';
}

export function qualityControls(state: ViewState) {
  return '<label class="setting-row">识别质量<select id="quality-select"><option value="quality"' + (state.quality === 'quality' ? ' selected' : '') + '>高质量 · Full</option><option value="balanced"' + (state.quality === 'balanced' ? ' selected' : '') + '>均衡 · Lite</option><option value="fast"' + (state.quality === 'fast' ? ' selected' : '') + '>流畅 · Lite</option></select></label><label class="setting-row"><span>自由运动与双目景深<small>允许跑动、下蹲与前后进退不中断；PS4 双目自动开启</small></span><input id="free-motion" type="checkbox"' + (state.freeMotion ? ' checked' : '') + '></label>' + (state.game === 'poses' ? '' : '<label class="setting-row"><span>游戏精细手部增强<small>菜单始终优先精细识别</small></span><input id="fine-hands" type="checkbox"' + (state.fine ? ' checked' : '') + '></label>');
}

export function calibrationView(state: ViewState) {
  const demo = state.mode === 'demo';
  const pose = state.game === 'poses';
  const hearts = state.game === 'hearts';
  const gates = state.game === 'gates';
  const bridge = state.game === 'bridge';
  return back() + '<div class="setup-grid"><div class="live-preview calibration-preview"><canvas id="stage" aria-label="玩家校准预览"></canvas><span class="preview-badge">' + (demo ? (pose ? '按钮演示 · 未使用摄像头' : '鼠标体验 · 未使用摄像头') : '自动取景 · 肩旁招手就好') + '</span><div class="framing-note">在舒服的位置，一起入镜就好</div><div class="calibration-state"><span id="calibration-status">' + (demo ? '体验模式，点击模拟站好' : '每人在肩旁举一只手，保持 2 秒') + '</span><progress id="calibration-progress" max="' + state.players + '" value="0"></progress></div></div><section class="setup-copy"><span class="eyebrow">HELLO, LITTLE HANDS</span><h1 id="calibration-title">舒服站定，<br>' + (pose ? '我们的模仿秀开场啦。' : hearts ? '准备好双手接爱心。' : gates ? '太空穿越门即将开启。' : bridge ? '点亮我们的彩虹桥。' : '和泡泡打个招呼。') + '</h1><ul class="tip-list"><li>' + icon('person') + (gates ? '留出左右滑步与前后跨步的小空间' : bridge ? '站定后可以左右移动和伸展双臂' : '两脚站稳，半身入镜也能玩') + '</li><li>' + icon('duo') + (gates ? '大人孩子一起看绿色安全门移动' : bridge ? '双人伸手靠近就会连起金色彩虹桥' : '手肘靠近身体，不用退远') + '</li><li>' + icon('spark') + '肩旁举手 2 秒，记住你的范围</li></ul><p>' + (pose ? '照着动作卡模仿上半身，双脚站稳。<br>各自完成保持，一起为默契加分。' : hearts ? '爱心、水晶鞋、公主裙和皇冠会一起落下。<br>稳稳接住宝物，躲开会变脸的小炸弹。' : gates ? '跳进绿色安全区就会戴上皇冠变身小公主，留在危险区会变成粉色毛兔。<br>一起下蹲滑步、前后跨步，还能挥手拍亮护盾星救场。' : bridge ? '用双臂搭起发光彩虹桥，送小精灵从左到城堡。<br>看到头顶雷云倒计时，大朋友小朋友一起下蹲。' : '泡泡会出现在每个人的伸手范围内。<br>手上的光点，应该跟着自己移动。') + '</p>' + spaceControls(state.spacePreference) + '<p id="space-status" class="space-status" aria-live="polite">' + spaceLabel(state.spaceMode) + '</p>' + (demo ? '<button id="calibrate" class="button secondary full" data-action="calibrate">模拟站好 2 秒</button>' : '') + '<button id="start-round" class="button primary full" data-action="start-round" disabled>准备好，开始吧' + icon('arrow') + '</button><p class="notice">侧伸手臂切换，胸前合掌确认，交叉搭肩返回；也可抬手指向停留。' + (pose || hearts || gates || bridge ? '游戏中请指向「歇一下」暂停，放心高举双手。' : '游戏中双手举起 1.5 秒可暂停。') + '</p></section></div>';
}

export function gameView(state: ViewState) {
  if (state.game === 'poses' && state.pose) return poseGameView(state.pose, state.gentle, state.mode === 'demo');
  if (state.game === 'hearts') return heartsGameView(state.players, state.gentle, state.mode === 'demo', state.spaceMode, state.round);
  if (state.game === 'gates') return gatesGameView(state.players, state.gentle, state.mode === 'demo', state.spaceMode, state.round);
  if (state.game === 'bridge') return bridgeGameView(state.players, state.gentle, state.mode === 'demo', state.spaceMode, state.round);
  return '<div class="game-header"><div class="game-title"><h1>泡泡派对</h1><p>' + (state.players === 2 ? '亲子合作' : '自己玩') + ' · ' + (state.gentle ? '小手模式' : '标准模式') + ' · ' + (state.mode === 'demo' ? '鼠标体验 · 未使用摄像头' : '挥手拍泡泡') + '</p><span id="space-badge" class="space-badge">' + spaceLabel(state.spaceMode) + '</span></div><div class="scoreboard"><div class="score-value"><small>快乐得分</small><strong id="score">' + state.round.score + '</strong></div><div class="score-value"><small>剩余时间</small><strong class="timer"><span id="time">60</span><small> 秒</small></strong></div><button id="pause" class="icon-button" data-action="pause" aria-label="暂停游戏">' + icon('pause') + '</button></div></div><div class="game-stage live-game"><canvas id="stage" aria-label="挥手拍泡泡游戏区域" tabindex="0"></canvas><div id="countdown" class="countdown-overlay"><p>小手准备好，快乐马上到</p><strong id="countdown-number">3</strong><h2>伸出手，一起拍！</h2></div><span id="tracking-hint" class="stage-hint"></span></div><div class="game-bottom"><span id="combo-label">拍到泡泡，快乐 +10</span><div class="round-progress"><span id="time-progress"></span></div><span>' + (state.mode === 'demo' ? '移动鼠标拍泡泡 / ' : '双手举起 1.5 秒 / ') + '<kbd>空格</kbd> 暂停</span></div>';
}

export function helpView(game: GameKind = 'bubbles') {
  if (game === 'poses') return poseHelpView();
  if (game === 'hearts') return heartsHelpView();
  if (game === 'gates') return gatesHelpView();
  if (game === 'bridge') return bridgeHelpView();
  return '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭说明">×</button><span class="eyebrow">HOW TO PLAY</span><h2>不用学，放开玩。</h2><div class="help-list"><div><b>1</b><section><h3>原地挥手</h3><p>碰到泡泡就得分。一起合作，漏掉也没关系。</p></section></div><div><b>2</b><section><h3>抬手，指向，停一停</h3><p>菜单上停留 1 秒，圆环转满就选中。放下手再选下一项。</p></section></div><div><b>3</b><section><h3>随时歇一歇</h3><p>双手举起 1.5 秒，或按空格暂停。每局后喝口水，休息一下。</p></section></div></div><button class="button primary full" data-action="close-modal">知道了</button>';
}
