import { renderMarkup } from './platform/dom.mjs';
import './ui/style.css';
import './ui/storybook.css';
import './ui/adventures.css';
import './ui/body-menu.css';
import './ui/television.css';
import { decorateTelevisionScreen, televisionPauseActions } from './ui/television-views.ts';
import { enterTvFullscreen, exitTvFullscreen } from './platform/television.ts';
import { BodyMenuNavigation } from './ui/body-navigation.ts';
import { adventurePicture, adventureNote, decorateAdventureScreen } from './ui/adventure-views.ts';
import { worldArt, mountArtwork } from './platform/world-art.ts';
import { VisualMotion } from './platform/visual-motion.ts';
import type { CropRect, HandObservation, Quality, ReachZone, TrackedPlayer, VisionFrame } from './types.ts';
import { CameraSession, cameraError, isOv580StereoFrame, isWideStereoFrame, stereoCropPreset, type CropPreset } from './platform/camera.ts';
import { frameLoop, Sound, downloadDiagnostics } from './platform/runtime.ts';
import { AnomalyLog } from './platform/anomaly-log.ts';
import { gameArt } from './platform/game-art.ts';
import { Metrics } from './platform/metrics.ts';
import { VisionPipeline } from './vision/pipeline.ts';
import { StereoDepthAnalyzer, computeStereoLayout } from './vision/stereo-depth.ts';
import { FreeMotionTracker } from './interaction/free-tracker.ts';
import { participantHands } from './interaction/participant-hands.ts';
import { PrimaryController } from './interaction/primary-controller.ts';
import { MotionContinuity, type ContinuousMotion } from './interaction/motion-continuity.ts';
import { PlayerHold } from './game/player-hold.ts';
import { gameMotionRequirements, supportsGateJudgement } from './game/motion-policy.ts';
import { validLandmark } from './interaction/geometry.ts';
import { Calibration } from './game/calibration.ts';
import { chooseSpaceMode } from './game/space.ts';
import { FramingController } from './interaction/framing.ts';
import { createRound, hit, miss, penalty, pauseRound, resumeRound, endRound, advanceRound } from './game/round.ts';
import { BubbleField, type HandPoint } from './game/field.ts';
import { HeartCatchField } from './game/hearts.ts';
import { SpaceGatesField } from './game/space-gates.ts';
import { RainbowBridgeField } from './game/rainbow-bridge.ts';
import { PoseSession } from './game/pose-session.ts';
import { demoPosePlayers, poseScene } from './ui/pose-art.ts';
import { syncPoseView } from './ui/pose-views.ts';
import { Stage } from './ui/stage.ts';
import { GestureNavigation } from './ui/navigation.ts';
import { icon } from './ui/icons.mjs';
import { homeView, deviceView, calibrationView, gameView, resultsView, helpView, escapeHtml, type ViewState } from './ui/screens.ts';

type Page = 'home' | 'device' | 'calibration' | 'game' | 'results';
const state: ViewState = { players: 2, gentle: true, quality: 'quality', round: createRound(), goldenHearts: 0, bombedCount: 0, gatesPassed: 0, gatesRescues: 0, bridgeEscorted: 0, bridgeDodged: 0, mode: 'live', fine: false, freeMotion: true, game: 'bubbles', pose: null, spacePreference: 'auto', spaceMode: 'standard' };
const main = document.querySelector<HTMLElement>('#main')!;
const modal = document.querySelector<HTMLDialogElement>('#modal')!;
const content = document.querySelector<HTMLElement>('#modal-content')!;
const sound = new Sound();
const visualMotion = new VisualMotion();
const metrics = new Metrics();
const anomalyLog = new AnomalyLog();
const navigation = new GestureNavigation((code, reason) => anomalyLog.record(code, reason, page, performance.now()));
const bodyNavigation = new BodyMenuNavigation(() => { void action('body-back'); });
const framing = new FramingController();
const primaryController = new PrimaryController();
const motionContinuity = new MotionContinuity();
let motion: ContinuousMotion = { players: [], inferred: false, protected: true, recovered: false };
const stereoDepth = new StereoDepthAnalyzer();
let page: Page = 'home';
let stage: Stage | null = null;
let field: BubbleField | null = null;
let hearts: HeartCatchField | null = null;
let gates: SpaceGatesField | null = null;
let bridge: RainbowBridgeField | null = null;
let pose: PoseSession | null = null;
let demoPoseActive: boolean[] = [];
let poseIndex = -1;
let poseScore = 0;
let poseArt = '';
let crop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
let latest: VisionFrame | null = null;
let players: TrackedPlayer[] = [];
let trustedHands: HandObservation[] = [];
let freeTracker = new FreeMotionTracker(state.players);
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
let televisionEnabled = true;
let televisionSettings = false;
let nativeFullscreen = Boolean(document.fullscreenElement);
let connecting = false;
let operation = 0;
const pauseGesture = new PlayerHold(1500, true);
const camera = new CameraSession(() => {
  anomalyLog.record('camera_ended', 'track_ended', page, performance.now());
  pipeline.stop(); bodyNavigation.hide(); visionReady = false; latest = null; players = [];
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
      bodyNavigation.suspend();
      anomalyLog.record('stale_frame', frame.capturedAt > now ? 'future_clock' : 'age_over_150ms', page, now);
      return;
    }
    latest = frame;
    const measurements = stereoDepth.measure(camera.video, crop, frame.poses);
    players = freeTracker.update(frame.poses, measurements, frame.capturedAt, page !== 'game' && page !== 'results');
    const binding = freeTracker.bindingState();
    trustedHands = participantHands(frame.hands, players, freeTracker.canStart() && binding.ignoredCount === 0 && frame.poses.length === players.length && !binding.ambiguous);
    metrics.inference(frame.inferenceMs, now - frame.capturedAt);
    if (page === 'calibration' || page === 'game') {
      if (page === 'game' && (state.game === 'hearts' || state.freeMotion)) stage?.setFraming({ x: 0, y: 0, width: 1, height: 1 });
      else stage?.setFraming(framing.update(freeTracker.isLocked ? players : [], frame.capturedAt));
    }
    if (page === 'calibration') {
      if (state.freeMotion) {
        calibrated = freeTracker.isCalibrated();
        const diag = freeTracker.lastDiagnostic();
        syncSpaceMode();
        setText('calibration-status', calibrationStatusText(diag));
        const progress = document.querySelector<HTMLProgressElement>('#calibration-progress');
        if (progress) progress.value = freeTracker.readyCount();
        setDisabled('start-round', !calibrated || !freeTracker.canStart());
      } else {
        calibrated = (calibrated ? calibration.adapt(players, frame.capturedAt) : calibration.update(players, frame.capturedAt)) && freeTracker.isCalibrated();
        const diag = calibration.lastDiagnostic();
        if (diag !== 'ok' && diag !== 'ready' && diag !== 'holding' && diag !== 'hand_not_raised') anomalyLog.record('calibration', diag, page, now);
        syncSpaceMode();
        setText('calibration-status', calibrationStatusText(diag));
        const progress = document.querySelector<HTMLProgressElement>('#calibration-progress');
        if (progress) progress.value = calibration.readyCount();
        setDisabled('start-round', !calibrated || !freeTracker.canStart());
      }
    }
    const previousController = primaryController.playerId;
    const menuPlayers = primaryController.update(freeTracker.isLocked ? players : [], state.players, freeTracker.isLocked);
    if (previousController !== primaryController.playerId) { navigation.reset(); bodyNavigation.reset(); pauseGesture.reset(); }
    stage?.setPrimaryController(primaryController.playerId);
    if (page === 'game') {
      motion = continuousMotion(frame.capturedAt);
      if (motion.recovered) { field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); }
      if (state.freeMotion) {
        if (motion.players.length === state.players) {
          zones = freeTracker.zones(motion.players, state.gentle, state.spaceMode === 'compact');
          field?.setZones(zones);
          hearts?.setZones(zones);
        }
      } else {
        calibration.adapt(players, frame.capturedAt);
        const diag = calibration.lastDiagnostic();
        if (diag !== 'ok') anomalyLog.record('calibration', diag, page, now);
        if (calibration.matches(players)) {
          zones = calibration.zones(players, state.gentle, state.spaceMode === 'compact');
          field?.setZones(zones);
          hearts?.setZones(zones);
        }
      }
    }
    if (page === 'game' && state.game === 'poses' && phase() === 'playing' && !countdown && !modal.open) {
      pose?.update(state.freeMotion ? motion.players : calibration.verifiedPlayers(motion.players), frame.capturedAt, sourceAspect());
      syncPoseState();
    }
    if (page === 'game' && state.game === 'hearts' && phase() === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      if (stage) hearts?.hands(motion.players.map(player => ({ playerId: player.id, left: player.wrists[0], right: player.wrists[1], shoulderWidth: player.shoulderWidth })), stage.fit, now);
    }
    if (page === 'game' && state.game === 'gates' && phase() === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      if (stage && !motionProtected()) gates?.observePlayers(motion.players, stage.fit);
    }
    if (page === 'game' && state.game === 'bridge' && phase() === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      if (stage && !motionProtected()) bridge?.observePlayers(motion.players, stage.fit);
    }
    if (page === 'game' && state.game === 'bubbles' && phase() === 'playing' && !countdown && !modal.open && readyToPlay(now)) {
      const hands: HandPoint[] = motion.players.flatMap(player => player.wrists.flatMap((point, index) => point ? [{ id: player.id + '-' + index, point }] : []));
      if (state.fine && now - frame.handsCapturedAt <= 150) for (const hand of trustedHands) {
        if (!validLandmark(hand.landmarks[0]) || !validLandmark(hand.landmarks[8])) continue;
        const nearest = hands.find(item => Math.hypot(item.point.x - hand.landmarks[0].x, item.point.y - hand.landmarks[0].y) < 0.12);
        if (nearest) nearest.point = hand.landmarks[8];
      }
      if (stage) field?.hands(hands, frame.capturedAt, stage.fit);
      if (pauseGesture.update(menuPlayers, frame.capturedAt)) pause('歇一下，快乐不赶时间。');
    } else pauseGesture.reset();
    if (page !== 'game' || modal.open) {
      const primary = modal.open ? dialogKind === 'pause' ? '#resume' : '[data-action="close-modal"].primary' : page === 'home' ? '#start' : page === 'device' ? '#device-next' : page === 'results' ? '#again' : '#start-round';
      const consumed = bodyNavigation.update(menuPlayers, frame, now, { context: page + '/' + dialogKind, primary, aspect: sourceAspect(), duo: state.players === 2, missing: primaryController.missing, members: freeTracker.isLocked ? '已绑定' + binding.boundCount + '人' + (binding.ignoredCount ? '，忽略旁观者' : '') : undefined, binding: !freeTracker.isLocked ? '先举一只手到肩膀上方，保持2秒绑定游玩伙伴（' + freeTracker.readyCount() + '/' + state.players + '）' : undefined });
      if (consumed) navigation.reset();
      else navigation.update(menuPlayers, frame, now, undefined, sourceAspect());
    } else {
      bodyNavigation.hide();
      navigation.update(menuPlayers, frame, now, ['pause'], sourceAspect());
    }
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
function gestures() { bodyNavigation.hide(); document.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((el, index) => el.dataset.gestureId = page + '/' + dialogKind + '/' + el.dataset.action + '/' + index); }
function setStatus(text: string, error = false) { statusMessage = text; statusError = error; setText('device-status', text); const el = document.getElementById('device-status'); if (el) el.dataset.error = String(error); }
function closeDialog() { modal.close(); dialogKind = ''; navigation.reset(); gestures(); pipeline.setHands(page !== 'game' || state.game === 'bubbles' && state.fine); }
function dialog(kind: string, html: string) {
  navigation.reset(); dialogKind = kind;
  const artwork = kind === 'help' ? '<div class="adventure-help">' + adventurePicture(state.game) + '</div>' : kind === 'pause' ? adventureNote(state.game, '休息一下，快乐不赶时间。') : '';
  renderMarkup(content, artwork + html + (kind === 'pause' ? televisionPauseActions() : '')); mountArtwork(content);
  if (!modal.open) modal.showModal();
  pipeline.setHands(true); gestures();
}
function show(next: Page) {
  closeDialog(); navigation.reset(); visualMotion.clear(); page = next; televisionSettings = false;
  void worldArt.preload(state.game);
  if (state.game === 'hearts') void gameArt.preload();
  if (page !== 'game') { field = null; hearts = null; gates = null; bridge = null; countdown = 0; }
  const screen = page === 'home' ? homeView(state) : page === 'device' ? deviceView(state) : page === 'calibration' ? calibrationView(state) : page === 'game' ? gameView(state) : resultsView(state);
  renderMarkup(main, decorateTelevisionScreen(decorateAdventureScreen(screen, state.game, page), page, state.mode === 'demo'));
  mountArtwork(main);
  main.dataset.page = page;
  main.dataset.game = state.game;
  main.focus({ preventScroll: true });
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  stage = canvas ? new Stage(canvas, state.game === 'poses' ? { world: state.game, illustration: poseScene(Array.from({ length: state.players }, () => 'rest'), state.spaceMode), opacity: 1, background: '#dceee5' } : { world: state.game, demoFaces: state.mode === 'demo' && (state.game === 'hearts' || state.game === 'gates') && page === 'game', skyStage: page === 'game' && state.game === 'hearts' }) : null;
  poseArt = '';
  if (canvas) {
    const pointer = (event: PointerEvent | MouseEvent) => {
      if (state.mode !== 'demo' || page !== 'game' || phase() !== 'playing' || countdown) return;
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (state.game === 'bubbles') field?.pointer(point, stage!.fit);
      else if (state.game === 'hearts') hearts?.pointer(point, stage!.fit);
      else if (state.game === 'gates') gates?.pointer(point, stage!.fit, event.type === 'click');
      else if (state.game === 'bridge') bridge?.pointer(point, stage!.fit);
    };
    canvas.addEventListener('pointermove', pointer); canvas.addEventListener('click', pointer);
  }
  pipeline.setHands(page !== 'game' || state.game === 'bubbles' && state.fine);
  syncConnection();
  if (page === 'device') { syncDevice(); if (camera.active) void listDevices(); }
  gestures();
}
function syncTelevision() {
  const active = televisionEnabled && (camera.active || state.mode === 'demo') && ['device', 'calibration', 'game'].includes(page);
  stage?.setTelevisionPresentation(active);
  document.documentElement.dataset.tvStage = active ? 'on' : 'off';
  main.dataset.tvSettings = televisionSettings ? 'open' : 'closed';
  main.dataset.tvInput = state.mode;
  const settings = document.getElementById('tv-settings-toggle');
  settings?.setAttribute('aria-expanded', String(televisionSettings));
  setText('tv-settings-label', televisionSettings ? '收起设置' : '画面设置');
  setText('tv-fullscreen-label', document.fullscreenElement ? '退出浏览器全屏' : '电视全屏');
  document.getElementById('fullscreen-toggle')?.setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏');
}

function syncConnection() {
  syncTelevision();
  const demoLabel = state.game === 'poses' ? '按钮演示' : '鼠标体验';
  setText('connection-badge', state.mode === 'demo' ? demoLabel : camera.active ? '摄像头已连接' : '本地体感');
  setText('footer-status', state.mode === 'demo' ? demoLabel + ' · 未使用摄像头' : camera.active ? '本地处理 · 不录像、不上传' : 'PS4 体感摄像头 · 本地运行');
  document.getElementById('disconnect')!.hidden = !camera.active;
  const settings = document.getElementById('camera-settings'); if (settings) settings.hidden = !camera.active;
}
function syncDevice() {
  syncConnection();
  setStatus(statusMessage, statusError);
  const placeholder = document.getElementById('camera-placeholder'); if (placeholder) placeholder.hidden = camera.active;
  setDisabled('connect-camera', connecting);
  setDisabled('confirm-crop', !camera.active || connecting);
  const next = document.getElementById('device-next'); if (next) next.hidden = !visionReady;
  const confirm = document.getElementById('confirm-crop'); if (confirm) confirm.hidden = visionReady;
  const cropWidth = Math.round(camera.video.videoWidth * crop.width);
  const cropHeight = Math.round(camera.video.videoHeight * crop.height);
  const cropped = crop.x > 0 || crop.y > 0 || crop.width < 1 || crop.height < 1;
  setText('preview-label', camera.active ? camera.video.videoWidth + ' × ' + camera.video.videoHeight + (cropped ? ' → ' + cropWidth + ' × ' + cropHeight : '') + (state.freeMotion && stereoDepth.stereoAvailable ? ' · 双目景深单眼预览' : ' · 单眼镜像预览') : '等待摄像头');
  const freeToggle = document.getElementById('free-motion') as HTMLInputElement | null;
  if (freeToggle) freeToggle.checked = state.freeMotion;
  for (const id of ['crop-preset-left', 'crop-preset-near', 'crop-preset-right', 'crop-preset-full']) setDisabled(id, !camera.active || connecting);
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
function clearTracking() { primaryController.reset(); motionContinuity.reset(); motion = { players: [], inferred: false, protected: true, recovered: false }; bodyNavigation.hide(); latest = null; players = []; trustedHands = []; freeTracker.reset(); stereoDepth.reset(); framing.reset(); navigation.reset(); calibrated = false; calibration = new Calibration(state.players); field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); pauseGesture.reset(); }
async function connect(deviceId?: string) {
  const token = ++operation;
  connecting = true; pipeline.stop(); visionReady = false; clearTracking(); crop = { x: 0, y: 0, width: 1, height: 1 };
  setStatus('请在浏览器允许摄像头访问……'); syncDevice();
  try {
    if (!await camera.start(deviceId) || token !== operation) return;
    const stereoLayout = computeStereoLayout(camera.video.videoWidth, camera.video.videoHeight);
    if (isOv580StereoFrame(camera.video.videoWidth, camera.video.videoHeight)) {
      crop = stereoCropPreset(camera.video.videoWidth, camera.video.videoHeight, 'left');
      state.freeMotion = true;
      setStatus('已连接 PS4 双目摄像头：自动裁出左单眼高清画面，并启用「双目景深 + 自由运动」追踪。正在自动开启体感菜单。');
    } else if (stereoLayout !== null) {
      crop = stereoCropPreset(camera.video.videoWidth, camera.video.videoHeight, 'left');
      state.freeMotion = true;
      setStatus('已连接双目宽幅画面（' + camera.video.videoWidth + ' × ' + camera.video.videoHeight + '），已启用双目景深。已自动裁出左单眼并开启体感菜单。');
    } else if (isWideStereoFrame(camera.video.videoWidth, camera.video.videoHeight)) {
      crop = stereoCropPreset(camera.video.videoWidth, camera.video.videoHeight, 'left');
      setStatus('已连接双目宽幅画面（' + camera.video.videoWidth + ' × ' + camera.video.videoHeight + '）。已使用左单眼预设，正在自动开启体感菜单。');
    } else {
      setStatus('已连接，正在自动开启体感菜单。');
    }
    await listDevices();
    if (token === operation) await startVision();
  } catch (error) { if (token === operation) setStatus(cameraError(error), true); }
  finally { if (token === operation) { connecting = false; syncDevice(); } }
}
function applyCropRect(next: CropRect, message: string) {
  crop = next;
  pipeline.stop(); visionReady = false; clearTracking(); syncDevice();
  setStatus(message);
  void startVision();
}
function applyCrop() {
  const values = ['x', 'y', 'width', 'height'].map(key => Number((document.getElementById('crop-' + key) as HTMLInputElement).value) / 100);
  if (!values.every(Number.isFinite) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > 1.00001 || values[1] + values[3] > 1.00001) { toast('裁剪必须在画面范围内，宽度和高度需要大于 0。'); return; }
  applyCropRect({ x: values[0], y: values[1], width: values[2], height: values[3] }, '裁剪已更新，正在恢复体感菜单。');
}
function applyCropPreset(preset: CropPreset) {
  if (!camera.active) return;
  const next = stereoCropPreset(camera.video.videoWidth, camera.video.videoHeight, preset);
  const labels: Record<CropPreset, string> = { left: '左单眼', 'left-near': '单眼拉近', right: '右单眼', full: '全画面' };
  applyCropRect(next, '已套用「' + labels[preset] + '」预设，正在恢复体感菜单。');
}
async function startVision() {
  if (!camera.active) return;
  const token = ++operation;
  connecting = true; clearTracking(); syncDevice(); metrics.reset();
  try { await pipeline.start(camera.video, { quality: state.quality, numPoses: state.players, hands: true }, crop); }
  catch (error) { if (token === operation) setStatus('识别启动失败：' + cameraError(error), true); }
  finally { if (token === operation) { connecting = false; syncDevice(); } }
}
function stopCamera() { bodyNavigation.hide(); operation++; connecting = false; pipeline.stop(); camera.stop(); visionReady = false; clearTracking(); }
function enterCalibration(rebind = false) { if (rebind) { primaryController.reset(); freeTracker = new FreeMotionTracker(state.players); players = []; trustedHands = []; } motionContinuity.reset(); motion = { players: [], inferred: false, protected: true, recovered: false }; calibration = new Calibration(state.players); framing.reset(); calibrated = false; demoCalibrate = 0; syncSpaceMode(); show('calibration'); syncSpaceMode(); }
function depthSummaryText() {
  const depths = players.map(player => player.depthMeters).filter((d): d is number => typeof d === 'number' && Number.isFinite(d));
  if (depths.length === 0) return '';
  return ' · 双目景深 ' + depths.map(d => d.toFixed(1) + 'm').join(' / ');
}
function calibrationStatusText(diag: string) {
  const depthTag = state.freeMotion ? depthSummaryText() : '';
  if (diag === 'too_many_raising' || freeTracker.lastDiagnostic() === 'too_many_raising') return '只让参加游戏的 ' + state.players + ' 位伙伴举手，其他人放松双手' + depthTag;
  if (calibrated) return (state.freeMotion ? '已绑定游玩伙伴，旁观者动作会忽略' + depthTag : '已绑定游玩伙伴，位置会自动跟随') + (state.players === 2 ? ' · 右侧伙伴主控菜单' : '，可以开始了');
  const readyCount = state.freeMotion ? freeTracker.readyCount() : calibration.readyCount();
  const count = '（已准备 ' + readyCount + ' / ' + state.players + ' 人' + depthTag + '）';
  if (freeTracker.lastDiagnostic() === 'too_many_raising') return '只请要玩的伙伴举手，旁观者放松双手，再保持2秒' + count;
  if (diag === 'identity_uncertain') return '等待已绑定伙伴，旁观者不会接替' + count;
  if (diag === 'no_player') return '还没看到上半身，请坐正或稍微退半步' + count;
  if (diag === 'no_shoulders') return '请让双肩完整进入画面' + count;
  if (diag === 'not_separated') return '两位伙伴稍微拉开一点距离' + count;
  if (diag === 'no_wrist') return '请让手腕进入画面，并举到肩膀上方' + count;
  if (diag === 'holding') return '很好，稳住举手 2 秒……' + count;
  return '把一只手抬到肩膀上方保持 2 秒' + count;
}
function currentMotionRequirements() { return gameMotionRequirements(state.game, state.gentle, gates?.stats.currentGate?.kind ?? null); }
function motionProtected() { return motion.protected || state.game === 'gates' && !supportsGateJudgement(players, state.gentle, gates?.stats.currentGate?.kind ?? null); }
function continuousMotion(timestamp: number) {
  return motionContinuity.update(players, timestamp, currentMotionRequirements());
}
function readyToPlay(now: number) {
  if (state.mode === 'demo') return true;
  if (!latest || now - latest.capturedAt > 150) return false;
  const active = page === 'game' ? motion.players : players;
  if (state.freeMotion) return active.length === state.players && zones.length === state.players;
  return zones.length === state.players && calibration.verifiedPlayers(active).length === state.players && zones.every(zone => active.some(player => player.id === zone.playerId));
}
function trackingFailureReason(now: number) {
  if (!latest || now - latest.capturedAt > 150) return 'stale_frame';
  if (players.length === 0) return 'no_player';
  if (state.freeMotion) return freeTracker.lastDiagnostic();
  if (!calibration.matches(players)) return calibration.lastDiagnostic();
  return 'zone_unmatched';
}
function trackingSnapshot(now: number) {
  const verified = state.freeMotion ? players.length : calibration.verifiedPlayers(players).length;
  const ready = state.freeMotion ? freeTracker.readyCount() : calibration.readyCount();
  return { binding: freeTracker.bindingState(), expected: state.players, detected: latest?.poses.length ?? 0, tracked: players.length, verified, ready, frameFresh: !!latest && now - latest.capturedAt <= 150, frameAgeMs: latest ? Math.round(Math.max(0, now - latest.capturedAt)) : null };
}
function startRound() {
  if (!calibrated || state.mode === 'live' && (!latest || performance.now() - latest.capturedAt > 150 || !freeTracker.canStart() || players.length !== state.players)) return;
  syncSpaceMode();
  zones = state.mode === 'demo'
    ? Array.from({ length: state.players }, (_, index) => ({ playerId: index + 1, x: state.players === 2 ? index * 0.45 + 0.06 : 0.15, y: state.gentle ? 0.42 : 0.2, width: state.players === 2 ? 0.35 : 0.7, height: state.gentle ? 0.4 : 0.64 }))
    : state.freeMotion
      ? freeTracker.zones(players, state.gentle, state.spaceMode === 'compact')
      : calibration.zones(players, state.gentle, state.spaceMode === 'compact');
  motionContinuity.reset();
  motion = continuousMotion(latest?.capturedAt ?? performance.now());
  state.round = pauseRound(createRound());
  state.goldenHearts = 0;
  state.bombedCount = 0;
  state.gatesPassed = 0;
  state.gatesRescues = 0;
  state.bridgeEscorted = 0;
  state.bridgeDodged = 0;
  if (state.game === 'poses') {
    pose = new PoseSession(zones.map(zone => zone.playerId), state.gentle, state.spaceMode); pose.pause(); poseIndex = -1; poseScore = 0; syncPoseState();
  } else { pose = null; state.pose = null; }
  show('game');
  field = null;
  hearts = null;
  gates = null;
  bridge = null;
  if (state.game === 'bubbles') field = new BubbleField(zones, state.gentle, id => { const next = hit(state.round, id); if (next === state.round) return false; state.round = next; sound.pop(next.combo); return true; }, () => registerMiss());
  if (state.game === 'hearts') hearts = new HeartCatchField(
    zones,
    state.gentle,
    event => { const next = hit(state.round, event.id, event.points); if (next === state.round) return false; state.round = next; if (event.golden) state.goldenHearts += 1; sound.pop(event.golden ? next.combo + 6 : next.combo); return true; },
    () => registerMiss(),
    event => { if (state.mode === 'live' && motionProtected()) return false; const next = penalty(state.round, event.id, event.points); if (next === state.round) return false; state.round = next; state.bombedCount += 1; sound.boom(); toast('嘭！魔法变身，过几秒就恢复啦！'); return true; },
  );
  if (state.game === 'gates') gates = new SpaceGatesField(
    state.players,
    state.gentle,
    event => {
      if (event.outcome === 'missed') {
        registerMiss();
        return;
      }
      const next = hit(state.round, 'gate-' + event.id, event.points);
      if (next !== state.round) state.round = next;
      state.gatesPassed += 1;
      if (event.outcome === 'shielded') {
        state.gatesRescues += 1;
        sound.shield();
      } else {
        sound.pop(state.round.combo + 4);
      }
    },
    () => sound.shield(),
  );
  if (state.game === 'bridge') bridge = new RainbowBridgeField(
    state.players,
    state.gentle,
    event => {
      if (event.kind === 'missed' || event.kind === 'zapped') {
        registerMiss();
        if (event.kind === 'zapped') sound.boom();
        return;
      }
      const next = hit(state.round, 'bridge-' + event.id, event.points);
      if (next !== state.round) state.round = next;
      if (event.kind === 'escort') state.bridgeEscorted += 1;
      if (event.kind === 'dodge') state.bridgeDodged += 1;
      sound.pop(state.round.combo + (event.golden ? 6 : 3));
    },
    () => sound.shield(),
  );
  countdown = 3000; lostSince = 0; wasValid = true; pauseGesture.reset();
}
function registerMiss() {
  if (state.mode !== 'live' || !motionProtected()) state.round = miss(state.round);
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
  countdown = 0; field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); pauseGesture.reset();
  const poses = state.game === 'poses';
  const heartsMode = state.game === 'hearts';
  const gatesMode = state.game === 'gates';
  const bridgeMode = state.game === 'bridge';
  dialog('pause', '<span class="pause-art" aria-hidden="true"><i></i><i></i></span><h2 id="pause-title">' + escapeHtml(reason) + '</h2><p>时间和得分都为你保留着。<span id="resume-hint"></span></p><button id="resume" class="button primary full" data-action="resume">' + (poses ? '继续我们的模仿秀' : heartsMode ? '继续接爱心' : gatesMode ? '继续穿越太空门' : bridgeMode ? '继续搭彩虹桥' : '继续拍泡泡') + '</button>' + (poses ? '<button id="skip-pose" class="button secondary full" data-action="skip-pose"' + (state.pose?.stage === 'celebrate' ? ' disabled' : '') + '>换个动作，不扣分</button>' : '') + '<button class="button secondary full" data-action="recalibrate">' + (poses ? '重新打招呼，开始新一局' : '重新确认伙伴') + '</button><button id="finish" class="button quiet full" data-action="finish" data-close-modal>结束这一局，看看成绩</button>');
}
function resume() {
  if (!readyToPlay(performance.now())) { toast('请让肩膀和小手入镜。换人或离开较久后，重新打个招呼。'); return; }
  motionContinuity.reset(); motion = continuousMotion(latest?.capturedAt ?? performance.now());
  closeDialog(); field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); pauseGesture.reset(); countdown = 3000; lostSince = 0;
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
    case 'select-bubbles': case 'select-poses': case 'select-hearts': case 'select-gates': case 'select-bridge': {
      const game = name === 'select-poses' ? 'poses' : name === 'select-hearts' ? 'hearts' : name === 'select-gates' ? 'gates' : name === 'select-bridge' ? 'bridge' : 'bubbles';
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
      state.players = count; freeTracker = new FreeMotionTracker(count);
      document.getElementById('mode-solo')?.setAttribute('aria-pressed', String(count === 1));
      document.getElementById('mode-duo')?.setAttribute('aria-pressed', String(count === 2));
      clearTracking();
      if (camera.active) { toast('正在调整识别人数，请稍候。'); await startVision(); if (visionReady) toast('准备好了，继续抬手选择。'); }
      break;
    }
    case 'gentle': state.gentle = !state.gentle; document.getElementById('gentle-mode')?.setAttribute('aria-checked', String(state.gentle)); break;
    case 'prepare': state.mode = 'live'; if (camera.active && visionReady) enterCalibration(); else show('device'); break;
    case 'device-settings': if (camera.active) show('device'); break;
    case 'connect': void enterTvFullscreen(); await sound.unlock(); await connect((document.getElementById('camera-select') as HTMLSelectElement)?.value || undefined); break;
    case 'confirm-crop': await startVision(); break;
    case 'crop': applyCrop(); break;
    case 'crop-left': applyCropPreset('left'); break;
    case 'crop-left-near': applyCropPreset('left-near'); break;
    case 'crop-right': applyCropPreset('right'); break;
    case 'crop-full': applyCropPreset('full'); break;
    case 'calibration': if (visionReady) enterCalibration(); break;
    case 'demo': stopCamera(); state.mode = 'demo'; await sound.unlock(); enterCalibration(); break;
    case 'calibrate': demoCalibrate = performance.now(); setDisabled('calibrate', true); break;
    case 'start-round': await sound.unlock(); startRound(); break;
    case 'pause': pause('歇一下，快乐不赶时间。'); break;
    case 'resume': resume(); break;
    case 'finish': finish(); break;
    case 'again': enterCalibration(true); break;
    case 'recalibrate': enterCalibration(true); break;
    case 'home': exitHome(); break;
    case 'body-back':
      if (modal.open) { if (dialogKind === 'pause') resume(); else await action('close-modal'); }
      else if (page !== 'home') exitHome();
      else toast('已经在游戏大厅，侧伸手臂选择，胸前合掌确认。');
      break;
    case 'help': if (page === 'game') pause('先看看怎么玩。'); dialog('help', helpView(state.game)); break;
    case 'diagnostics': diagnostics(); break;
    case 'close-modal': if (page === 'game' && phase() === 'paused') pause('准备好，就继续快乐。'); else closeDialog(); break;
    case 'disconnect': stopCamera(); show('home'); toast('摄像头已关闭。'); break;
    case 'export': downloadDiagnostics({ version: '0.3.0', game: state.game, quality: state.quality, mode: state.mode, spacePreference: state.spacePreference, spaceMode: state.spaceMode, stereo: { freeMotion: state.freeMotion, dualEyeActive: stereoDepth.stereoAvailable, depthsMeters: players.map(player => typeof player.depthMeters === 'number' && Number.isFinite(player.depthMeters) ? Math.round(player.depthMeters * 100) / 100 : null) }, source: { width: camera.video.videoWidth, height: camera.video.videoHeight, frameRate: camera.settings.frameRate }, metrics: metrics.snapshot(performance.now()), pipeline: pipeline.stats, tracking: trackingSnapshot(performance.now()), anomalies: anomalyLog.snapshot() }); break;
    case 'sound': sound.enabled = !sound.enabled; await sound.unlock(); updateToolbar(); break;
    case 'tv-settings':
      televisionSettings = !televisionSettings; syncTelevision(); gestures();
      break;
    case 'tv-standard':
      if (page === 'game' && !modal.open) pause('先歇一下，正在返回普通布局。');
      televisionEnabled = false; televisionSettings = false; syncTelevision(); gestures();
      await exitTvFullscreen();
      break;
    case 'fullscreen': {
      televisionEnabled = true; syncTelevision(); gestures();
      const success = document.fullscreenElement ? await exitTvFullscreen() : await enterTvFullscreen();
      if (!success) toast('已铺满画面。隐藏浏览器栏请点一次「电视全屏」，或使用浏览器全屏快捷键。');
      syncTelevision();
      break;
    }
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
  if (target.id === 'free-motion') { state.freeMotion = target.checked; motionContinuity.reset(); motion = { players: [], inferred: false, protected: true, recovered: false }; calibration = new Calibration(state.players); calibrated = false; framing.reset(); syncDevice(); setStatus(state.freeMotion ? '已开启「自由运动与双目景深」追踪，跑动与前后进退不中断。' : '已切换为小客厅严格原地校准模式。'); }
});
document.addEventListener('keydown', event => {
  if (/INPUT|SELECT/.test((event.target as Element).tagName)) return;
  if (event.code === 'Space' && page === 'game') { event.preventDefault(); if (modal.open) resume(); else pause('歇一下，快乐不赶时间。'); }
});
modal.addEventListener('cancel', event => { event.preventDefault(); if (dialogKind === 'pause') resume(); else void action('close-modal'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { visualMotion.suspend(); bodyNavigation.suspend(); motionContinuity.reset(); motion = { players: [], inferred: false, protected: true, recovered: false }; if (page === 'game') pause('切回画面后，我们再继续。'); latest = null; players = []; navigation.reset(); field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); } });
document.addEventListener('fullscreenchange', () => {
  const wasFullscreen = nativeFullscreen;
  nativeFullscreen = Boolean(document.fullscreenElement);
  syncTelevision(); gestures();
  if (wasFullscreen && !nativeFullscreen && televisionEnabled && page === 'game' && !modal.open && (phase() === 'playing' || countdown > 0)) pause('已退出全屏，先歇一下。');
});
window.addEventListener('resize', () => { navigation.reset(); bodyNavigation.suspend(); });
window.addEventListener('pagehide', () => { stopCamera(); sound.close(); clock.stop(); });

const clock = frameLoop((now, delta) => {
  metrics.render(now);
  const fresh = state.mode === 'live' && latest && now - latest.capturedAt <= 150;
  if (!fresh) { navigation.suspend(); bodyNavigation.suspend(); }
  if (stage && state.mode === 'live' && latest && now - latest.capturedAt > 500) { framing.reset(); stage.setFraming({ x: 0, y: 0, width: 1, height: 1 }); }
  if (stage) stage.draw(state.mode === 'live' && camera.active ? camera.video : null, crop, freeTracker.isLocked ? page === 'game' && fresh ? motion.players : players : [], latest, field ?? hearts ?? gates ?? bridge, now, trustedHands);
  if (page === 'calibration' && state.mode === 'live') setDisabled('start-round', !calibrated || !fresh || !freeTracker.canStart());
  if (page === 'calibration' && demoCalibrate) {
    const progress = document.getElementById('calibration-progress') as HTMLProgressElement;
    progress.value = Math.min(state.players, (now - demoCalibrate) / 2000 * state.players);
    if (now - demoCalibrate >= 2000) { demoCalibrate = 0; calibrated = true; setText('calibration-status', '模拟站位已准备好，可以开始体验'); setDisabled('start-round', false); }
  }
  if (page === 'game') {
    const valid = readyToPlay(now);
    if (!valid && wasValid) anomalyLog.record('tracking_lost', trackingFailureReason(now), page, now);
    wasValid = valid;
    const observed = state.mode === 'demo' || !!fresh && players.length === state.players && (state.freeMotion || calibration.verifiedPlayers(motion.players).length === state.players);
    if (!observed) lostSince ||= now; else lostSince = 0;
    if (!valid) { field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); }
    const advancing = valid && (state.mode === 'demo' || !motionProtected());
    const pauseDelayMs = state.freeMotion ? 2500 : 1000;
    if (lostSince && now - lostSince >= pauseDelayMs && !modal.open) pause('暂时没看清伙伴，先轻松歇一下。');
    if (delta > 250 && !modal.open && !countdown && phase() === 'playing') pause('画面刚才停了一下，准备好再继续。');
    if (countdown && !modal.open) {
      if (advancing) countdown = Math.max(0, countdown - Math.min(delta, 100));
      setText('countdown-number', String(Math.ceil(countdown / 1000)));
      if (!countdown) {
        if (state.game === 'poses') { pose?.resume(); syncPoseState(); } else state.round = resumeRound(state.round);
        field?.clearTrails(); hearts?.clearTrails(); gates?.clearTrails(); bridge?.clearTrails(); document.getElementById('countdown')!.hidden = true;
      }
    } else if (!modal.open && phase() === 'playing') {
      if (state.game === 'poses') {
        if (advancing) {
          if (state.mode === 'demo' && state.pose) pose?.update(demoPosePlayers(state.pose.players.map(player => player.id), state.pose.target, demoPoseActive, state.pose.spaceMode), now, 1);
          pose?.advance(delta); syncPoseState();
        }
      } else if (state.game === 'hearts') {
        if (advancing) {
          state.round = advanceRound(state.round, delta);
          hearts?.setRemainingMs(state.round.remainingMs);
          if (stage) hearts?.update(delta, stage.fit);
        }
      } else if (state.game === 'gates') {
        if (advancing) {
          state.round = advanceRound(state.round, delta);
          gates?.setRemainingMs(state.round.remainingMs);
          if (stage) gates?.update(delta, stage.fit);
        }
      } else if (state.game === 'bridge') {
        if (advancing) {
          state.round = advanceRound(state.round, delta);
          bridge?.setRemainingMs(state.round.remainingMs);
          if (stage) bridge?.update(delta, stage.fit);
        }
      } else if (advancing) {
        state.round = advanceRound(state.round, delta);
        if (stage) field?.update(delta, stage.fit);
      }
      if (phase() === 'results') finish();
    }
    if (dialogKind === 'pause') { setDisabled('resume', !valid); setText('resume-hint', valid ? '' : state.freeMotion ? ' 请回到画面内，即可直接继续。' : ' 请让肩膀入镜；换人或离开较久后，重新打个招呼。'); }
    const handsVisible = state.mode === 'demo' || state.game === 'poses' || state.game === 'gates' || state.game === 'bridge' || players.some(player => player.wrists.some(Boolean));
    setText('tracking-hint', !modal.open ? (state.mode === 'live' && motionProtected() && valid ? '动作暂时看不清，进度为你保留着' : !valid ? (state.freeMotion ? '等待伙伴回到画面中……' : '暂停计时中，请让双肩入镜') : !handsVisible ? (state.game === 'hearts' ? '伸出双手，接住爱心和宝物' : '抬起小手，在画面中拍泡泡') : '') : '');
  }
  if (page === 'game' && state.game === 'poses' && now - poseUiTick >= 50) { poseUiTick = now; updatePosePresentation(); }
  if (now - uiTick > 150) {
    uiTick = now;
    if (page === 'game') {
      if (state.freeMotion && state.mode === 'live') {
        setText('space-badge', '自由运动' + (stereoDepth.stereoAvailable ? (depthSummaryText() || ' · 双目景深') : ''));
      }
      if (state.game === 'bubbles' || state.game === 'hearts' || state.game === 'gates' || state.game === 'bridge') {
        setText('score', String(state.round.score)); setText('time', String(Math.ceil(state.round.remainingMs / 1000)));
        const fallbackLabel = state.game === 'hearts' ? (hearts?.waveLabel() ?? '伸出双手，接住爱心和宝物') : state.game === 'gates' ? (gates?.waveLabel() ?? '太空起航 · 跟着星门指示动起来！') : state.game === 'bridge' ? (bridge?.waveLabel() ?? '伸展双臂搭起彩虹桥，把小精灵送到云朵城堡！') : '拍到泡泡，快乐 +10';
        const comboLabel = state.game === 'hearts' ? '连续接住 ' + state.round.combo + ' 件宝物，太有默契啦！' : state.game === 'gates' ? '连续穿越 ' + state.round.combo + ' 扇星门，配合太赞啦！' : state.game === 'bridge' ? '连续亮眼操作 ' + state.round.combo + ' 次，彩虹能量满格！' : '连续拍中 ' + state.round.combo + ' 个，默契加倍！';
        setText('combo-label', state.round.combo > 1 ? comboLabel : fallbackLabel);
        const progress = document.getElementById('time-progress'); if (progress) progress.style.width = state.round.remainingMs / 600 + '%';
      }
    }
    if (dialogKind === 'diagnostics') {
      const snapshot = metrics.snapshot(now);
      const values = [['画面绘制', snapshot.renderFps + ' fps'], ['有效姿态更新', snapshot.poseFps + ' Hz'], ['有效帧推理 P95', snapshot.inferenceP95 + ' ms'], ['有效帧年龄 P95', snapshot.frameAgeP95 + ' ms']];
      renderMarkup(document.getElementById('metrics')!, values.map(([label, value]) => '<div><small>' + label + '</small><b>' + value + '</b></div>').join(''));
      const tracking = trackingSnapshot(now);
      const cropDesc = crop.x > 0 || crop.y > 0 || crop.width < 1 || crop.height < 1 ? ' → ' + Math.round(camera.video.videoWidth * crop.width) + ' × ' + Math.round(camera.video.videoHeight * crop.height) : '';
      const modeDesc = state.freeMotion ? ' · 自由运动' + (stereoDepth.stereoAvailable ? (depthSummaryText() || ' · 双目景深就绪') : '') : '';
      setText('metrics-note', (state.mode === 'demo' ? '演示模式没有启用识别模型，识别统计为 0。' : '执行器 ' + (pipeline.stats.delegate ?? '未启动') + ' · 丢弃 ' + pipeline.stats.dropped + ' 帧 · 采集 ' + camera.video.videoWidth + ' × ' + camera.video.videoHeight + cropDesc + modeDesc + ' · 检测 ' + tracking.detected + ' 人 / 有效身体 ' + tracking.tracked + ' 人 / 校准有效 ' + tracking.verified + ' 人') + ' · ' + anomalyLog.summary());
    }
  }
  visualMotion.sync(main, { paused: modal.open || page === 'game' && (!readyToPlay(now) || phase() !== 'playing' && !countdown), score: page === 'game' ? (state.game === 'poses' ? state.pose?.score ?? 0 : state.round.score) : null, countdown: Math.ceil(countdown / 1000) });
  if (toastUntil && now > toastUntil) { document.getElementById('toast')!.classList.remove('show'); toastUntil = 0; }
});
updateToolbar(); show('home'); clock.start();
