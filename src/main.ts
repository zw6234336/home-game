import { renderMarkup } from './platform/dom.mjs';
import './ui/style.css';
import './ui/storybook.css';
import type { CropRect, Quality, ReachZone, TrackedPlayer, VisionFrame } from './types.ts';
import { CameraSession, cameraError } from './platform/camera.ts';
import { frameLoop, Sound, downloadDiagnostics } from './platform/runtime.ts';
import { AnomalyLog } from './platform/anomaly-log.ts';
import { gameArt } from './platform/game-art.ts';
import { Metrics } from './platform/metrics.ts';
import { VisionPipeline } from './vision/pipeline.ts';
import { PlayerTracker } from './interaction/tracker.ts';
import { PlayerRoster } from './interaction/roster.ts';
import { PlayerHold } from './game/player-hold.ts';
import { validLandmark } from './interaction/geometry.ts';
import { Calibration } from './game/calibration.ts';
import { chooseSpaceMode } from './game/space.ts';
import { FramingController } from './interaction/framing.ts';
import { createRound, hit, miss, penalty, pauseRound, resumeRound, endRound, advanceRound } from './game/round.ts';
import { BubbleField, type HandPoint } from './game/field.ts';
import { HeartCatchField } from './game/hearts.ts';
import { PoseSession } from './game/pose-session.ts';
import { demoPosePlayers, poseScene } from './ui/pose-art.ts';
import { syncPoseView } from './ui/pose-views.ts';
import { Stage } from './ui/stage.ts';
import { GestureNavigation } from './ui/navigation.ts';
import { icon } from './ui/icons.mjs';
import { homeView, deviceView, calibrationView, gameView, resultsView, helpView, escapeHtml, type ViewState } from './ui/screens.ts';

type Page = 'home' | 'device' | 'calibration' | 'game' | 'results';
const state: ViewState = { players: 2, gentle: true, quality: 'quality', round: createRound(), goldenHearts: 0, bombedCount: 0, mode: 'live', fine: false, game: 'bubbles', pose: null, spacePreference: 'auto', spaceMode: 'standard' };
const main = document.querySelector<HTMLElement>('#main')!;
const modal = document.querySelector<HTMLDialogElement>('#modal')!;
const content = document.querySelector<HTMLElement>('#modal-content')!;
const sound = new Sound();
const metrics = new Metrics();
const anomalyLog = new AnomalyLog();
const navigation = new GestureNavigation((code, reason) => anomalyLog.record(code, reason, page, performance.now()));
const framing = new FramingController();
const roster = new PlayerRoster();
let page: Page = 'home';
let stage: Stage | null = null;
let field: BubbleField | null = null;
let hearts: HeartCatchField | null = null;
let pose: PoseSession | null = null;
let demoPoseActive: boolean[] = [];
let poseIndex = -1;
let poseScore = 0;
let poseArt = '';
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
let wasValid = true;
let statusMessage = '等待连接';
let statusError = false;
let toastUntil = 0;
let uiTick = 0;
let poseUiTick = 0;
let dialogKind = '';
let connecting = false;
let operation = 0;
const pauseGesture = new PlayerHold(1500, true);
const camera = new CameraSession(() => {
  anomalyLog.record('camera_ended', 'track_ended', page, performance.now());
  pipeline.stop(); visionReady = false; latest = null; players = [];
  if (page === 'game') pause('摄像头断开了。时间和分数已经保留。');
  setStatus('摄像头已断开，请重新连接并校准。', true); syncDevice();
});
const pipeline = new VisionPipeline({
  onStatus(status) { visionReady = status.state === 'ready'; setStatus(status.message); syncDevice(); },
  onError(error) { anomalyLog.record('vision_error', error.name || 'runtime', page, performance.now()); visionReady = false; setStatus('识别未就绪：' + error.message, true); if (page === 'game') pause('识别已中断，请重新连接并校准。'); },
  onFrame(frame) {
    if (document.hidden || state.mode !== 'live') return;
    const now = performance.now();
    if (now - frame.capturedAt > 150 || frame.capturedAt > now) {
      anomalyLog.record('stale_frame', frame.capturedAt > now ? 'future_clock' : 'age_over_150ms', page, now);
      return;
    }
    latest = frame;
    const selectedPoses = roster.select(frame.poses, state.players, frame.capturedAt);
    players = tracker.update(selectedPoses, frame.capturedAt);
    metrics.inference(frame.inferenceMs, now - frame.capturedAt);
    if (page === 'calibration' || page === 'game') stage?.setFraming(framing.update(players, frame.capturedAt));
    if (page === 'calibration') {
      calibrated = calibrated ? calibration.adapt(players, frame.capturedAt) : calibration.update(players, frame.capturedAt);
      if (calibrated) roster.lock(players);
      else {
        if (calibration.readyCount() === 0) roster.unlock();
        roster.syncConfirmed(calibration.verifiedPlayers(players));
      }
      const diag = calibration.lastDiagnostic();
      if (diag !== 'ok' && diag !== 'ready' && diag !== 'holding' && diag !== 'hand_not_raised') anomalyLog.record('calibration', diag, page, now);
      syncSpaceMode();
      setText('calibration-status', calibrationStatusText(diag));
      const progress = document.querySelector<HTMLProgressElement>('#calibration-progress');
      if (progress) progress.value = calibration.readyCount();
      setDisabled('start-round', !calibrated);
    }
    if (page === 'game') {
      calibration.adapt(players, frame.capturedAt);
      const diag = calibration.lastDiagnostic();
      if (diag !== 'ok') anomalyLog.record('calibration', diag, page, now);
      if (calibration.matches(players)) {
        zones = calibration.zones(players, state.gentle, state.spaceMode === 'compact');
        field?.setZones(zones);
        hearts?.setZones(zones);
      }
    }
    if (page === 'game' && state.game === 'poses' && phase() === 'playing' && !countdown && !modal.open) {
      pose?.update(calibration.verifiedPlayers(players), frame.capturedAt, sourceAspect());
      syncPoseState();
    }
    if (page === 'game' && state.game === 'hearts' && phase() === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      if (stage) hearts?.hands(players.map(player => ({ playerId: player.id, left: player.wrists[0], right: player.wrists[1], shoulderWidth: player.shoulderWidth })), stage.fit, now);
    }
    if (page === 'game' && state.game === 'bubbles' && phase() === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      const hands: HandPoint[] = players.flatMap(player => player.wrists.flatMap((point, index) => point ? [{ id: player.id + '-' + index, point }] : []));
      if (state.fine && now - frame.handsCapturedAt <= 150) for (const hand of frame.hands) {
        if (!validLandmark(hand.landmarks[0]) || !validLandmark(hand.landmarks[8])) continue;
        const nearest = hands.find(item => Math.hypot(item.point.x - hand.landmarks[0].x, item.point.y - hand.landmarks[0].y) < 0.12);
        if (nearest) nearest.point = hand.landmarks[8];
      }
      if (stage) field?.hands(hands, frame.capturedAt, stage.fit);
      if (pauseGesture.update(players, frame.capturedAt)) pause('歇一下，快乐不赶时间。');
    } else pauseGesture.reset();
    if (page !== 'game' || modal.open) navigation.update(players, frame, now, undefined, sourceAspect());
    else if (state.game === 'poses' || state.game === 'hearts') navigation.update(players, frame, now, ['pause'], sourceAspect());
  }
});

function setText(id: string, text: string) { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; }
function sourceAspect() { return camera.video.videoHeight ? camera.video.videoWidth * crop.width / (camera.video.videoHeight * crop.height) : 1; }
function syncSpaceMode() {
  state.spaceMode = state.mode === 'demo' ? (state.spacePreference === 'compact' ? 'compact' : 'standard') : chooseSpaceMode(players, state.spacePreference, sourceAspect());
  setText('space-status', state.spacePreference === 'auto' ? '自动适应 · ' + (state.spaceMode === 'compact' ? '已选小幅动作，半身也能玩' : '空间合适，位置会自动跟随') : '小客厅 · 手肘靠近身体就好');
}
function phase() { return state.game === 'poses' ? state.pose?.phase ?? 'paused' : state.round.phase; }
function syncPoseState() {
  if (!pose) return;
  const snapshot = pose.snapshot;
  if (snapshot.index !== poseIndex) { demoPoseActive = snapshot.players.map(() => false); poseIndex = snapshot.index; }
  if (snapshot.score > poseScore) sound.pop(snapshot.completed + 4);
  poseScore = snapshot.score;
  state.pose = snapshot;
}
function updatePosePresentation() {
  if (!state.pose) return;
  syncPoseView(state.pose, demoPoseActive, state.mode === 'demo');
  if (state.mode === 'demo') {
    const key = state.pose.spaceMode + '/' + state.pose.target + '/' + demoPoseActive.join('/');
    if (key !== poseArt) { poseArt = key; stage?.setIllustration(poseScene(demoPoseActive.map(active => active ? state.pose!.target : 'rest'), state.pose.spaceMode)); }
  }
}
function setDisabled(id: string, value: boolean) { const el = document.getElementById(id) as HTMLButtonElement | null; if (el) el.disabled = value; }
function toast(text: string) { setText('toast', text); document.getElementById('toast')!.classList.add('show'); toastUntil = performance.now() + 4200; }
function gestures() { document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((el, index) => el.dataset.gestureId = page + '/' + dialogKind + '/' + el.dataset.action + '/' + index); }
function setStatus(text: string, error = false) { statusMessage = text; statusError = error; setText('device-status', text); const el = document.getElementById('device-status'); if (el) el.dataset.error = String(error); }
function closeDialog() { modal.close(); dialogKind = ''; navigation.reset(); gestures(); pipeline.setHands(page !== 'game' || state.game === 'bubbles' && state.fine); }
function dialog(kind: string, html: string) {
  navigation.reset(); dialogKind = kind; renderMarkup(content, html);
  if (!modal.open) modal.showModal();
  pipeline.setHands(true); gestures();
}
function show(next: Page) {
  closeDialog(); navigation.reset(); page = next;
  if (state.game === 'hearts') void gameArt.preload();
  if (page !== 'game') { field = null; hearts = null; countdown = 0; }
  renderMarkup(main, page === 'home' ? homeView(state) : page === 'device' ? deviceView(state) : page === 'calibration' ? calibrationView(state) : page === 'game' ? gameView(state) : resultsView(state));
  main.dataset.page = page;
  main.dataset.game = state.game;
  main.focus({ preventScroll: true });
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  stage = canvas ? new Stage(canvas, state.game === 'poses' ? { illustration: poseScene(Array.from({ length: state.players }, () => 'rest'), state.spaceMode), opacity: 1, background: '#dceee5' } : { demoFaces: state.mode === 'demo' && state.game === 'hearts' && page === 'game' }) : null;
  poseArt = '';
  if (canvas) {
    const pointer = (event: PointerEvent | MouseEvent) => {
      if (state.mode !== 'demo' || page !== 'game' || phase() !== 'playing' || countdown) return;
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (state.game === 'bubbles') field?.pointer(point, stage!.fit);
      else if (state.game === 'hearts') hearts?.pointer(point, stage!.fit);
    };
    canvas.addEventListener('pointermove', pointer); canvas.addEventListener('click', pointer);
  }
  pipeline.setHands(page !== 'game' || state.game === 'bubbles' && state.fine);
  syncConnection();
  if (page === 'device') { syncDevice(); if (camera.active) void listDevices(); }
  gestures();
}
function syncConnection() {
  const demoLabel = state.game === 'poses' ? '按钮演示' : '鼠标体验';
  setText('connection-badge', state.mode === 'demo' ? demoLabel : camera.active ? '摄像头已连接' : '本地体感');
  setText('footer-status', state.mode === 'demo' ? demoLabel + ' · 未使用摄像头' : camera.active ? '本地处理 · 不录像、不上传' : 'PS4 体感摄像头 · 本地运行');
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
function clearTracking() { latest = null; players = []; roster.reset(); tracker.reset(); framing.reset(); navigation.reset(); calibrated = false; calibration = new Calibration(state.players); field?.clearTrails(); hearts?.clearTrails(); pauseGesture.reset(); }
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
function enterCalibration() { calibration = new Calibration(state.players); roster.reset(); framing.reset(); calibrated = false; demoCalibrate = 0; syncSpaceMode(); show('calibration'); syncSpaceMode(); }
function calibrationStatusText(diag: string) {
  if (calibrated) return '记住你们啦！位置会自动跟随，可以开始了';
  const count = '（已准备 ' + calibration.readyCount() + ' / ' + state.players + ' 人）';
  if (diag === 'no_player') return '还没看到上半身，请坐正或稍微退半步' + count;
  if (diag === 'no_shoulders') return '请让双肩完整进入画面' + count;
  if (diag === 'not_separated') return '两位伙伴稍微拉开一点距离' + count;
  if (diag === 'no_wrist') return '请让手腕进入画面，并举到肩膀上方' + count;
  if (diag === 'holding') return '很好，稳住举手 2 秒……' + count;
  return '把一只手抬到肩膀上方保持 2 秒' + count;
}
function readyToPlay(now: number) { return state.mode === 'demo' || !!latest && now - latest.capturedAt <= 150 && zones.length === state.players && calibration.matches(players) && zones.every(zone => players.some(player => player.id === zone.playerId)); }
function trackingFailureReason(now: number) {
  if (!latest || now - latest.capturedAt > 150) return 'stale_frame';
  if (players.length === 0) return 'no_player';
  if (!calibration.matches(players)) return calibration.lastDiagnostic();
  return 'zone_unmatched';
}
function trackingSnapshot(now: number) {
  return { expected: state.players, detected: latest?.poses.length ?? 0, tracked: players.length, verified: calibration.verifiedPlayers(players).length, ready: calibration.readyCount(), frameFresh: !!latest && now - latest.capturedAt <= 150, frameAgeMs: latest ? Math.round(Math.max(0, now - latest.capturedAt)) : null };
}
function startRound() {
  if (!calibrated || state.mode === 'live' && (!latest || performance.now() - latest.capturedAt > 150)) return;
  syncSpaceMode();
  zones = state.mode === 'demo' ? Array.from({ length: state.players }, (_, index) => ({ playerId: index + 1, x: state.players === 2 ? index * 0.45 + 0.06 : 0.15, y: state.gentle ? 0.42 : 0.2, width: state.players === 2 ? 0.35 : 0.7, height: state.gentle ? 0.4 : 0.64 })) : calibration.zones(players, state.gentle, state.spaceMode === 'compact');
  state.round = pauseRound(createRound());
  state.goldenHearts = 0;
  state.bombedCount = 0;
  if (state.game === 'poses') {
    pose = new PoseSession(zones.map(zone => zone.playerId), state.gentle, state.spaceMode); pose.pause(); poseIndex = -1; poseScore = 0; syncPoseState();
  } else { pose = null; state.pose = null; }
  show('game');
  field = null;
  hearts = null;
  if (state.game === 'bubbles') field = new BubbleField(zones, state.gentle, id => { const next = hit(state.round, id); if (next === state.round) return false; state.round = next; sound.pop(next.combo); return true; }, () => state.round = miss(state.round));
  if (state.game === 'hearts') hearts = new HeartCatchField(
    zones,
    state.gentle,
    event => { const next = hit(state.round, event.id, event.points); if (next === state.round) return false; state.round = next; if (event.golden) state.goldenHearts += 1; sound.pop(event.golden ? next.combo + 6 : next.combo); return true; },
    () => state.round = miss(state.round),
    event => { const next = penalty(state.round, event.id, event.points); if (next === state.round) return false; state.round = next; state.bombedCount += 1; sound.boom(); toast('嘭！魔法变身，过几秒就恢复啦！'); return true; },
  );
  countdown = 3000; lostSince = 0; wasValid = true; pauseGesture.reset();
}
function pauseReasonCode(reason: string) {
  if (reason.includes('暂时没看清')) return 'tracking_lost';
  if (reason.includes('画面刚才停了一下')) return 'frame_stall';
  if (reason.includes('摄像头断开')) return 'camera_ended';
  if (reason.includes('识别已中断')) return 'vision_error';
  if (reason.includes('切回画面')) return 'visibility_hidden';
  if (reason.includes('歇一下')) return 'pause_or_gesture';
  return 'other';
}
function pause(reason: string) {
  if (page !== 'game' || phase() === 'results') return;
  anomalyLog.record('auto_pause', pauseReasonCode(reason), page, performance.now());
  if (state.game === 'poses') { pose?.pause(); syncPoseState(); updatePosePresentation(); } else state.round = pauseRound(state.round);
  countdown = 0; field?.clearTrails(); hearts?.clearTrails(); pauseGesture.reset();
  const poses = state.game === 'poses';
  const heartsMode = state.game === 'hearts';
  dialog('pause', '<span class="pause-art" aria-hidden="true"><i></i><i></i></span><h2 id="pause-title">' + escapeHtml(reason) + '</h2><p>时间和得分都为你保留着。<span id="resume-hint"></span></p><button id="resume" class="button primary full" data-action="resume">' + (poses ? '继续我们的模仿秀' : heartsMode ? '继续接爱心' : '继续拍泡泡') + '</button>' + (poses ? '<button id="skip-pose" class="button secondary full" data-action="skip-pose"' + (state.pose?.stage === 'celebrate' ? ' disabled' : '') + '>换个动作，不扣分</button>' : '') + '<button class="button secondary full" data-action="recalibrate">' + (poses ? '重新打招呼，开始新一局' : '重新确认伙伴') + '</button><button id="finish" class="button quiet full" data-action="finish" data-close-modal>结束这一局，看看成绩</button>');
}
function resume() {
  if (!readyToPlay(performance.now())) { toast('请让肩膀和小手入镜。换人或离开较久后，重新打个招呼。'); return; }
  closeDialog(); field?.clearTrails(); hearts?.clearTrails(); pauseGesture.reset(); countdown = 3000; lostSince = 0;
  document.getElementById('countdown')!.hidden = false;
}
function finish() { if (state.game === 'poses') { pose?.end(); syncPoseState(); } else state.round = endRound(state.round); show('results'); }
function diagnostics() {
  if (page === 'game') pause('先看一下运行状态。');
  dialog('diagnostics', '<button class="dialog-close icon-button" data-action="close-modal" data-close-modal aria-label="关闭运行状态">×</button><span class="eyebrow">LOCAL PERFORMANCE</span><h2>看见每一次响应。</h2><div class="metric-grid" id="metrics"></div><p id="metrics-note"></p><p>统计仅包含有效帧，过期帧另计丢弃。物理端到端延迟待电视实测；低帧率时可在设备页切换质量档。</p><button class="button secondary full" data-action="export">导出诊断摘要</button><button class="button primary full" data-action="close-modal">回到游戏</button>');
}
function exitHome() {
  if (page === 'game' && phase() !== 'results') { pause('这局还没结束，先歇一下。'); return; }
  show('home');
}

async function action(name: string) {
  switch (name) {
    case 'space-auto': case 'space-compact': {
      if (page !== 'home' && page !== 'calibration') break;
      const preference = name === 'space-compact' ? 'compact' : 'auto';
      if (preference === state.spacePreference) break;
      state.spacePreference = preference;
      syncSpaceMode(); navigation.reset();
      if (page === 'home') show('home');
      else for (const mode of ['auto', 'compact']) document.getElementById('space-' + mode)?.setAttribute('aria-pressed', String(mode === state.spacePreference));
      break;
    }
    case 'select-bubbles': case 'select-poses': case 'select-hearts': {
      const game = name === 'select-poses' ? 'poses' : name === 'select-hearts' ? 'hearts' : 'bubbles';
      if (page !== 'home' || state.game === game) break;
      state.game = game; pose = null; state.pose = null; show('home');
      break;
    }
    case 'demo-pose-0': case 'demo-pose-1': {
      if (state.mode !== 'demo' || state.game !== 'poses' || page !== 'game' || phase() !== 'playing' || countdown || modal.open || state.pose?.stage !== 'pose') break;
      const index = name.endsWith('0') ? 0 : 1;
      if (index < state.players) { demoPoseActive[index] = !demoPoseActive[index]; updatePosePresentation(); }
      break;
    }
    case 'skip-pose': if (state.game === 'poses' && page === 'game' && dialogKind === 'pause') { pose?.skip(); syncPoseState(); setDisabled('skip-pose', true); resume(); } break;
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
    case 'help': if (page === 'game') pause('先看看怎么玩。'); dialog('help', helpView(state.game)); break;
    case 'diagnostics': diagnostics(); break;
    case 'close-modal': if (page === 'game' && phase() === 'paused') pause('准备好，就继续快乐。'); else closeDialog(); break;
    case 'disconnect': stopCamera(); show('home'); toast('摄像头已关闭。'); break;
    case 'export': downloadDiagnostics({ version: '0.3.0', game: state.game, quality: state.quality, mode: state.mode, spacePreference: state.spacePreference, spaceMode: state.spaceMode, source: { width: camera.video.videoWidth, height: camera.video.videoHeight, frameRate: camera.settings.frameRate }, metrics: metrics.snapshot(performance.now()), pipeline: pipeline.stats, tracking: trackingSnapshot(performance.now()), anomalies: anomalyLog.snapshot() }); break;
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
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (page === 'game') pause('切回画面后，我们再继续。'); latest = null; players = []; navigation.reset(); field?.clearTrails(); hearts?.clearTrails(); } });
window.addEventListener('pagehide', () => { stopCamera(); sound.close(); clock.stop(); });

const clock = frameLoop((now, delta) => {
  metrics.render(now);
  const fresh = state.mode === 'live' && latest && now - latest.capturedAt <= 150;
  if (!fresh) navigation.suspend();
  if (stage && state.mode === 'live' && latest && now - latest.capturedAt > 500) { framing.reset(); stage.setFraming({ x: 0, y: 0, width: 1, height: 1 }); }
  if (stage) stage.draw(state.mode === 'live' && camera.active ? camera.video : null, crop, players, latest, field ?? hearts, now);
  if (page === 'calibration' && state.mode === 'live') setDisabled('start-round', !calibrated || !fresh);
  if (page === 'calibration' && demoCalibrate) {
    const progress = document.getElementById('calibration-progress') as HTMLProgressElement;
    progress.value = Math.min(state.players, (now - demoCalibrate) / 2000 * state.players);
    if (now - demoCalibrate >= 2000) { demoCalibrate = 0; calibrated = true; setText('calibration-status', '模拟站位已准备好，可以开始体验'); setDisabled('start-round', false); }
  }
  if (page === 'game') {
    const valid = readyToPlay(now);
    if (!valid && wasValid) anomalyLog.record('tracking_lost', trackingFailureReason(now), page, now);
    wasValid = valid;
    if (!valid) { lostSince ||= now; field?.clearTrails(); hearts?.clearTrails(); } else lostSince = 0;
    if (lostSince && now - lostSince >= 1000 && !modal.open) pause('暂时没看清伙伴，先轻松歇一下。');
    if (delta > 250 && !modal.open && !countdown && phase() === 'playing') pause('画面刚才停了一下，准备好再继续。');
    if (countdown && !modal.open) {
      if (valid) countdown = Math.max(0, countdown - Math.min(delta, 100));
      setText('countdown-number', String(Math.ceil(countdown / 1000)));
      if (!countdown) {
        if (state.game === 'poses') { pose?.resume(); syncPoseState(); } else state.round = resumeRound(state.round);
        field?.clearTrails(); hearts?.clearTrails(); document.getElementById('countdown')!.hidden = true;
      }
    } else if (!modal.open && phase() === 'playing') {
      if (state.game === 'poses') {
        if (valid) {
          if (state.mode === 'demo' && state.pose) pose?.update(demoPosePlayers(state.pose.players.map(player => player.id), state.pose.target, demoPoseActive, state.pose.spaceMode), now, 1);
          pose?.advance(delta); syncPoseState();
        }
      } else if (state.game === 'hearts') {
        if (valid) {
          state.round = advanceRound(state.round, delta);
          hearts?.setRemainingMs(state.round.remainingMs);
          if (stage) hearts?.update(delta, stage.fit);
        }
      } else if (valid) {
        state.round = advanceRound(state.round, delta);
        if (stage) field?.update(delta, stage.fit);
      }
      if (phase() === 'results') finish();
    }
    if (dialogKind === 'pause') { setDisabled('resume', !valid); setText('resume-hint', valid ? '' : ' 请让肩膀入镜；换人或离开较久后，重新打个招呼。'); }
    const handsVisible = state.mode === 'demo' || state.game === 'poses' || players.some(player => player.wrists.some(Boolean));
    setText('tracking-hint', !modal.open ? (!valid ? '暂停计时中，请让双肩入镜' : !handsVisible ? (state.game === 'hearts' ? '伸出双手，接住爱心和宝物' : '抬起小手，在画面中拍泡泡') : '') : '');
  }
  if (page === 'game' && state.game === 'poses' && now - poseUiTick >= 50) { poseUiTick = now; updatePosePresentation(); }
  if (now - uiTick > 150) {
    uiTick = now;
    if (page === 'game') {
      if (state.game === 'bubbles' || state.game === 'hearts') {
        setText('score', String(state.round.score)); setText('time', String(Math.ceil(state.round.remainingMs / 1000)));
        const fallbackLabel = state.game === 'hearts' ? (hearts?.waveLabel() ?? '伸出双手，接住爱心和宝物') : '拍到泡泡，快乐 +10';
        const comboLabel = state.game === 'hearts' ? '连续接住 ' + state.round.combo + ' 件宝物，太有默契啦！' : '连续拍中 ' + state.round.combo + ' 个，默契加倍！';
        setText('combo-label', state.round.combo > 1 ? comboLabel : fallbackLabel);
        const progress = document.getElementById('time-progress'); if (progress) progress.style.width = state.round.remainingMs / 600 + '%';
      }
    }
    if (dialogKind === 'diagnostics') {
      const snapshot = metrics.snapshot(now);
      const values = [['画面绘制', snapshot.renderFps + ' fps'], ['有效姿态更新', snapshot.poseFps + ' Hz'], ['有效帧推理 P95', snapshot.inferenceP95 + ' ms'], ['有效帧年龄 P95', snapshot.frameAgeP95 + ' ms']];
      renderMarkup(document.getElementById('metrics')!, values.map(([label, value]) => '<div><small>' + label + '</small><b>' + value + '</b></div>').join(''));
      const tracking = trackingSnapshot(now);
      setText('metrics-note', (state.mode === 'demo' ? '演示模式没有启用识别模型，识别统计为 0。' : '执行器 ' + (pipeline.stats.delegate ?? '未启动') + ' · 丢弃 ' + pipeline.stats.dropped + ' 帧 · 采集 ' + camera.video.videoWidth + ' × ' + camera.video.videoHeight + ' · 检测 ' + tracking.detected + ' 人 / 有效身体 ' + tracking.tracked + ' 人 / 校准有效 ' + tracking.verified + ' 人') + ' · ' + anomalyLog.summary());
    }
  }
  if (toastUntil && now > toastUntil) { document.getElementById('toast')!.classList.remove('show'); toastUntil = 0; }
});
updateToolbar(); show('home'); clock.start();
