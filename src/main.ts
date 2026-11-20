import { renderMarkup } from './platform/dom.mjs';
import './ui/style.css';
import type { CropRect, Quality, ReachZone, TrackedPlayer, VisionFrame } from './types.ts';
import { CameraSession, cameraError } from './platform/camera.ts';
import { frameLoop, Sound, downloadDiagnostics } from './platform/runtime.ts';
import { Metrics } from './platform/metrics.ts';
import { VisionPipeline } from './vision/pipeline.ts';
import { PlayerTracker } from './interaction/tracker.ts';
import { PlayerHold } from './game/player-hold.ts';
import { validLandmark } from './interaction/geometry.ts';
import { Calibration } from './game/calibration.ts';
import { createRound, hit, miss, pauseRound, resumeRound, endRound, advanceRound } from './game/round.ts';
import { BubbleField, type HandPoint } from './game/field.ts';
import { Stage } from './ui/stage.ts';
import { GestureNavigation } from './ui/navigation.ts';
import { icon } from './ui/icons.mjs';
import { homeView, deviceView, calibrationView, gameView, resultsView, helpView, escapeHtml, type ViewState } from './ui/screens.ts';

type Page = 'home' | 'device' | 'calibration' | 'game' | 'results';
const state: ViewState = { players: 2, gentle: true, quality: 'quality', round: createRound(), mode: 'live', fine: false };
const main = document.querySelector<HTMLElement>('#main')!;
const modal = document.querySelector<HTMLDialogElement>('#modal')!;
const content = document.querySelector<HTMLElement>('#modal-content')!;
const sound = new Sound();
const metrics = new Metrics();
const navigation = new GestureNavigation();
let page: Page = 'home';
let stage: Stage | null = null;
let field: BubbleField | null = null;
let crop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
let latest: VisionFrame | null = null;
let players: TrackedPlayer[] = [];
let tracker = new PlayerTracker(state.players);
let calibration = new Calibration(state.players);
let zones: ReachZone[] = [];
let calibrated = false;
let visionReady = false;
let countdown = 0;
let demoCalibrate = 0;
let lostSince = 0;
let statusMessage = '等待连接';
let statusError = false;
let toastUntil = 0;
let uiTick = 0;
let dialogKind = '';
let connecting = false;
let operation = 0;
const pauseGesture = new PlayerHold(1500);
const camera = new CameraSession(() => {
  pipeline.stop(); visionReady = false; latest = null; players = [];
  if (page === 'game') pause('摄像头断开了。时间和分数已经保留。');
  setStatus('摄像头已断开，请重新连接并校准。', true); syncDevice();
});
const pipeline = new VisionPipeline({
  onStatus(status) { visionReady = status.state === 'ready'; setStatus(status.message); syncDevice(); },
  onError(error) { visionReady = false; setStatus('识别未就绪：' + error.message, true); if (page === 'game') pause('识别已中断，请重新连接并校准。'); },
  onFrame(frame) {
    if (document.hidden || state.mode !== 'live') return;
    const now = performance.now();
    if (now - frame.capturedAt > 150 || frame.capturedAt > now) return;
    latest = frame;
    players = tracker.update(frame.poses, frame.capturedAt);
    metrics.inference(frame.inferenceMs, now - frame.capturedAt);
    if (page === 'calibration') {
      calibrated = calibration.update(players, frame.capturedAt);
      setText('calibration-status', calibrated ? '站好啦！轻松伸伸手，再指向开始按钮' : '已准备 ' + calibration.readyCount() + ' / ' + state.players + ' 人 · 举手保持 2 秒');
      const progress = document.querySelector<HTMLProgressElement>('#calibration-progress');
      if (progress) progress.value = calibration.readyCount();
      setDisabled('start-round', !calibrated);
    }
    if (page === 'game' && state.round.phase === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      const hands: HandPoint[] = players.flatMap(player => player.wrists.flatMap((point, index) => point ? [{ id: player.id + '-' + index, point }] : []));
      if (state.fine && now - frame.handsCapturedAt <= 150) for (const hand of frame.hands) {
        if (!validLandmark(hand.landmarks[0]) || !validLandmark(hand.landmarks[8])) continue;
        const nearest = hands.find(item => Math.hypot(item.point.x - hand.landmarks[0].x, item.point.y - hand.landmarks[0].y) < 0.12);
        if (nearest) nearest.point = hand.landmarks[8];
      }
      if (stage) field?.hands(hands, frame.capturedAt, stage.fit);
      if (pauseGesture.update(players, frame.capturedAt)) pause('歇一下，快乐不赶时间。');
    } else pauseGesture.reset();
    if (page !== 'game' || modal.open) navigation.update(players, frame, now);
  }
});

function setText(id: string, text: string) { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; }
function setDisabled(id: string, value: boolean) { const el = document.getElementById(id) as HTMLButtonElement | null; if (el) el.disabled = value; }
function toast(text: string) { setText('toast', text); document.getElementById('toast')!.classList.add('show'); toastUntil = performance.now() + 4200; }
function gestures() { document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((el, index) => el.dataset.gestureId = page + '/' + dialogKind + '/' + el.dataset.action + '/' + index); }
function setStatus(text: string, error = false) { statusMessage = text; statusError = error; setText('device-status', text); const el = document.getElementById('device-status'); if (el) el.dataset.error = String(error); }
function closeDialog() { modal.close(); dialogKind = ''; navigation.reset(); gestures(); pipeline.setHands(page !== 'game' || state.fine); }
function dialog(kind: string, html: string) {
  navigation.reset(); dialogKind = kind; renderMarkup(content, html);
  if (!modal.open) modal.showModal();
  pipeline.setHands(true); gestures();
}
function show(next: Page) {
  closeDialog(); navigation.reset(); page = next;
  if (page !== 'game') { field = null; countdown = 0; }
  renderMarkup(main, page === 'home' ? homeView(state) : page === 'device' ? deviceView(state) : page === 'calibration' ? calibrationView(state) : page === 'game' ? gameView(state) : resultsView(state));
  main.dataset.page = page;
  main.focus({ preventScroll: true });
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  stage = canvas ? new Stage(canvas) : null;
  if (canvas) {
    const pointer = (event: PointerEvent | MouseEvent) => {
      if (state.mode !== 'demo' || page !== 'game' || state.round.phase !== 'playing' || countdown) return;
      const rect = canvas.getBoundingClientRect(); field?.pointer({ x: event.clientX - rect.left, y: event.clientY - rect.top }, stage!.fit);
    };
    canvas.addEventListener('pointermove', pointer); canvas.addEventListener('click', pointer);
  }
  pipeline.setHands(page !== 'game' || state.fine);
  syncConnection();
  if (page === 'device') { syncDevice(); if (camera.active) void listDevices(); }
  gestures();
}
function syncConnection() {
  setText('connection-badge', state.mode === 'demo' ? '鼠标体验' : camera.active ? '摄像头已连接' : '本地体感');
  setText('footer-status', state.mode === 'demo' ? '鼠标体验 · 未使用摄像头' : camera.active ? '本地处理 · 不录像、不上传' : 'PS4 体感摄像头 · 本地运行');
  document.getElementById('disconnect')!.hidden = !camera.active;
}
function syncDevice() {
  syncConnection();
  setStatus(statusMessage, statusError);
  const placeholder = document.getElementById('camera-placeholder'); if (placeholder) placeholder.hidden = camera.active;
  setDisabled('connect-camera', connecting);
  setDisabled('confirm-crop', !camera.active || connecting);
  const next = document.getElementById('device-next'); if (next) next.hidden = !visionReady;
  const confirm = document.getElementById('confirm-crop'); if (confirm) confirm.hidden = visionReady;
  setText('preview-label', camera.active ? camera.video.videoWidth + ' × ' + camera.video.videoHeight + ' · 单眼镜像预览' : '等待摄像头');
  for (const key of ['x', 'y', 'width', 'height'] as const) { const input = document.getElementById('crop-' + key) as HTMLInputElement | null; if (input) input.value = String(Math.round(crop[key] * 1000) / 10); }
}
async function listDevices() {
  try {
    const devices = await camera.devices();
    const select = document.getElementById('camera-select') as HTMLSelectElement | null;
    if (!select) return;
    select.replaceChildren(...devices.map((device, index) => new Option(device.label || '摄像头 ' + (index + 1), device.deviceId)));
    select.value = camera.settings.deviceId ?? '';
  } catch { setStatus('无法列出摄像头，仍可使用已连接设备。'); }
}
function clearTracking() { latest = null; players = []; tracker.reset(); navigation.reset(); calibrated = false; calibration = new Calibration(state.players); field?.clearTrails(); pauseGesture.reset(); }
async function connect(deviceId?: string) {
  const token = ++operation;
  connecting = true; pipeline.stop(); visionReady = false; clearTracking(); crop = { x: 0, y: 0, width: 1, height: 1 };
  setStatus('请在浏览器允许摄像头访问……'); syncDevice();
  try {
    if (!await camera.start(deviceId) || token !== operation) return;
    setStatus('已连接。请确认预览只有一份人物，再启动识别。');
    await listDevices();
  } catch (error) { if (token === operation) setStatus(cameraError(error), true); }
  finally { if (token === operation) { connecting = false; syncDevice(); } }
}
function applyCrop() {
  const values = ['x', 'y', 'width', 'height'].map(key => Number((document.getElementById('crop-' + key) as HTMLInputElement).value) / 100);
  if (!values.every(Number.isFinite) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 1.00001 || values[1] + values[3] > 1.00001) { toast('裁剪必须在画面范围内，宽度和高度需要大于 0。'); return; }
  crop = { x: values[0], y: values[1], width: values[2], height: values[3] };
  pipeline.stop(); visionReady = false; clearTracking(); syncDevice();
  setStatus('裁剪已更新，请确认单眼画面后启动识别。');
}
async function startVision() {
  if (!camera.active) return;
  const token = ++operation;
  connecting = true; clearTracking(); syncDevice(); metrics.reset();
  try { await pipeline.start(camera.video, { quality: state.quality, numPoses: state.players, hands: true }, crop); }
  catch (error) { if (token === operation) setStatus('识别启动失败：' + cameraError(error), true); }
  finally { if (token === operation) { connecting = false; syncDevice(); } }
}
function stopCamera() { operation++; connecting = false; pipeline.stop(); camera.stop(); visionReady = false; clearTracking(); }
function enterCalibration() { calibration = new Calibration(state.players); calibrated = false; demoCalibrate = 0; show('calibration'); }
function readyToPlay(now: number) { return state.mode === 'demo' || !!latest && now - latest.capturedAt <= 150 && zones.length === state.players && calibration.matches(players) && zones.every(zone => players.some(player => player.id === zone.playerId && player.wrists.some(Boolean))); }
function startRound() {
  if (!calibrated || state.mode === 'live' && (!latest || performance.now() - latest.capturedAt > 150)) return;
  zones = state.mode === 'demo' ? Array.from({ length: state.players }, (_, index) => ({ playerId: index + 1, x: state.players === 2 ? index * 0.45 + 0.06 : 0.15, y: state.gentle ? 0.42 : 0.2, width: state.players === 2 ? 0.35 : 0.7, height: state.gentle ? 0.4 : 0.64 })) : calibration.zones(players, state.gentle);
  state.round = pauseRound(createRound()); show('game');
  field = new BubbleField(zones, state.gentle, id => { const next = hit(state.round, id); if (next === state.round) return false; state.round = next; sound.pop(next.combo); return true; }, () => state.round = miss(state.round));
  countdown = 3000; lostSince = 0;
}
function pause(reason: string) {
  if (page !== 'game' || state.round.phase === 'results') return;
  state.round = pauseRound(state.round); countdown = 0; field?.clearTrails();
  dialog('pause', '<span class="pause-art" aria-hidden="true"><i></i><i></i></span><h2 id="pause-title">' + escapeHtml(reason) + '</h2><p>时间和得分都为你保留着。<span id="resume-hint"></span></p><button id="resume" class="button primary full" data-action="resume">继续拍泡泡</button><button class="button secondary full" data-action="recalibrate">重新站好位置</button><button id="finish" class="button quiet full" data-action="finish" data-close-modal>结束这一局，看看成绩</button>');
}
function resume() {
  if (!readyToPlay(performance.now())) { toast('请回到原来位置。若换了站位，请重新校准。'); return; }
  closeDialog(); field?.clearTrails(); countdown = 3000; lostSince = 0;
  document.getElementById('countdown')!.hidden = false;
}
function finish() { state.round = endRound(state.round); show('results'); }
function diagnostics() {
  if (page === 'game') pause('先看一下运行状态。');
  dialog('diagnostics', '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭运行状态">×</button><span class="eyebrow">LOCAL PERFORMANCE</span><h2>看见每一次响应。</h2><div class="metric-grid" id="metrics"></div><p id="metrics-note"></p><p>统计仅包含有效帧，过期帧另计丢弃。物理端到端延迟待电视实测；低帧率时可在设备页切换质量档。</p><button class="button secondary full" data-action="export">导出诊断摘要</button><button class="button primary full" data-action="close-modal">回到游戏</button>');
}
function exitHome() {
  if (page === 'game' && state.round.phase !== 'results') { pause('这局还没结束，先歇一下。'); return; }
  show('home');
}

async function action(name: string) {
  switch (name) {
    case 'solo': case 'duo': {
      const count = name === 'solo' ? 1 : 2;
      if (count === state.players) break;
      state.players = count; tracker = new PlayerTracker(count);
      document.getElementById('mode-solo')?.setAttribute('aria-pressed', String(count === 1));
      document.getElementById('mode-duo')?.setAttribute('aria-pressed', String(count === 2));
      clearTracking();
      if (camera.active) { toast('正在调整识别人数，请稍候。'); await startVision(); if (visionReady) toast('准备好了，继续抬手选择。'); }
      break;
    }
    case 'gentle': state.gentle = !state.gentle; document.getElementById('gentle-mode')?.setAttribute('aria-checked', String(state.gentle)); break;
    case 'prepare': state.mode = 'live'; show('device'); break;
    case 'connect': await sound.unlock(); await connect((document.getElementById('camera-select') as HTMLSelectElement)?.value || undefined); break;
    case 'confirm-crop': await startVision(); break;
    case 'crop': applyCrop(); break;
    case 'calibration': if (visionReady) enterCalibration(); break;
    case 'demo': stopCamera(); state.mode = 'demo'; await sound.unlock(); enterCalibration(); break;
    case 'calibrate': demoCalibrate = performance.now(); setDisabled('calibrate', true); break;
    case 'start-round': await sound.unlock(); startRound(); break;
    case 'pause': pause('歇一下，快乐不赶时间。'); break;
    case 'resume': resume(); break;
    case 'finish': finish(); break;
    case 'again': enterCalibration(); break;
    case 'recalibrate': enterCalibration(); break;
    case 'home': exitHome(); break;
    case 'help': if (page === 'game') pause('先看看怎么玩。'); dialog('help', helpView()); break;
    case 'diagnostics': diagnostics(); break;
    case 'close-modal': if (page === 'game' && state.round.phase === 'paused') pause('准备好，就继续快乐。'); else closeDialog(); break;
    case 'disconnect': stopCamera(); show('home'); toast('摄像头已关闭。'); break;
    case 'export': downloadDiagnostics({ version: '0.1.0', quality: state.quality, mode: state.mode, source: { width: camera.video.videoWidth, height: camera.video.videoHeight, frameRate: camera.settings.frameRate }, metrics: metrics.snapshot(performance.now()), pipeline: pipeline.stats }); break;
    case 'sound': sound.enabled = !sound.enabled; await sound.unlock(); updateToolbar(); break;
    case 'fullscreen': try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('首次全屏请点击屏幕上的全屏按钮，或按浏览器 F11。'); } break;
  }
}
function updateToolbar() {
  const button = document.getElementById('sound-toggle')!;
  renderMarkup(button, icon(sound.enabled ? 'sound' : 'mute')); button.setAttribute('aria-label', sound.enabled ? '关闭声音' : '开启声音'); button.setAttribute('aria-pressed', String(sound.enabled));
  renderMarkup(document.getElementById('fullscreen-toggle')!, icon('full'));
}

document.addEventListener('click', event => { const target = (event.target as Element).closest<HTMLButtonElement>('button[data-action]'); if (target && !target.disabled) void action(target.dataset.action!).catch(error => toast(cameraError(error))); });
document.addEventListener('change', event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'camera-select') void connect(target.value);
  if (target.id === 'quality-select') { state.quality = target.value as Quality; pipeline.stop(); visionReady = false; clearTracking(); syncDevice(); setStatus('质量已切换，请重新启动识别。'); }
  if (target.id === 'fine-hands') state.fine = target.checked;
});
document.addEventListener('keydown', event => {
  if (/INPUT|SELECT/.test((event.target as Element).tagName)) return;
  if (event.code === 'Space' && page === 'game') { event.preventDefault(); if (modal.open) resume(); else pause('歇一下，快乐不赶时间。'); }
});
modal.addEventListener('cancel', event => { event.preventDefault(); if (dialogKind === 'pause') resume(); else void action('close-modal'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (page === 'game') pause('切回画面后，我们再继续。'); latest = null; players = []; navigation.reset(); field?.clearTrails(); } });
window.addEventListener('pagehide', () => { stopCamera(); sound.close(); clock.stop(); });

const clock = frameLoop((now, delta) => {
  metrics.render(now);
  const fresh = state.mode === 'live' && latest && now - latest.capturedAt <= 150;
  if (!fresh) navigation.suspend();
  if (stage) stage.draw(state.mode === 'live' && camera.active ? camera.video : null, crop, players, latest, field, now);
  if (page === 'calibration' && state.mode === 'live') setDisabled('start-round', !calibrated || !fresh);
  if (page === 'calibration' && demoCalibrate) {
    const progress = document.getElementById('calibration-progress') as HTMLProgressElement;
    progress.value = Math.min(state.players, (now - demoCalibrate) / 2000 * state.players);
    if (now - demoCalibrate >= 2000) { demoCalibrate = 0; calibrated = true; setText('calibration-status', '模拟站位已准备好，可以开始体验'); setDisabled('start-round', false); }
  }
  if (page === 'game') {
    const valid = readyToPlay(now);
    if (!valid) { lostSince ||= now; field?.clearTrails(); } else lostSince = 0;
    if (lostSince && now - lostSince >= 1000 && !modal.open) pause('暂时没看清小手，请回到原来位置。');
    if (delta > 250 && !modal.open && !countdown && state.round.phase === 'playing') pause('画面刚才停了一下，准备好再继续。');
    if (countdown && !modal.open) {
      if (valid) countdown = Math.max(0, countdown - Math.min(delta, 100));
      setText('countdown-number', String(Math.ceil(countdown / 1000)));
      if (!countdown) { state.round = resumeRound(state.round); field?.clearTrails(); document.getElementById('countdown')!.hidden = true; }
    } else if (!modal.open && state.round.phase === 'playing') {
      state.round = advanceRound(state.round, delta);
      if (stage) field?.update(delta, stage.fit);
      if (state.round.phase === 'results') finish();
    }
    if (dialogKind === 'pause') { setDisabled('resume', !valid); setText('resume-hint', valid ? '' : ' 请回到原位；换人或换位置需要重新校准。'); }
    setText('tracking-hint', !valid && !modal.open ? '看向摄像头，让小手回到画面里' : '');
  }
  if (now - uiTick > 150) {
    uiTick = now;
    if (page === 'game') {
      setText('score', String(state.round.score)); setText('time', String(Math.ceil(state.round.remainingMs / 1000)));
      setText('combo-label', state.round.combo > 1 ? '连续拍中 ' + state.round.combo + ' 个，默契加倍！' : '拍到泡泡，快乐 +10');
      const progress = document.getElementById('time-progress'); if (progress) progress.style.width = state.round.remainingMs / 600 + '%';
    }
    if (dialogKind === 'diagnostics') {
      const snapshot = metrics.snapshot(now);
      const values = [['画面绘制', snapshot.renderFps + ' fps'], ['有效姿态更新', snapshot.poseFps + ' Hz'], ['有效帧推理 P95', snapshot.inferenceP95 + ' ms'], ['有效帧年龄 P95', snapshot.frameAgeP95 + ' ms']];
      renderMarkup(document.getElementById('metrics')!, values.map(([label, value]) => '<div><small>' + label + '</small><b>' + value + '</b></div>').join(''));
      setText('metrics-note', state.mode === 'demo' ? '鼠标体验没有启用识别模型，识别统计为 0。' : '执行器 ' + (pipeline.stats.delegate ?? '未启动') + ' · 丢弃 ' + pipeline.stats.dropped + ' 帧 · 采集 ' + camera.video.videoWidth + ' × ' + camera.video.videoHeight);
    }
  }
  if (toastUntil && now > toastUntil) { document.getElementById('toast')!.classList.remove('show'); toastUntil = 0; }
});
updateToolbar(); show('home'); clock.start();
