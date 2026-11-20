import { renderMarkup } from './utils/dom.mjs';
import { createRound, hit, advanceRound, pauseRound, resumeRound, endRound, miss } from './model.mjs';
import { createFrameClock, createSound, toggleFullscreen } from './utils/runtime.mjs';
import { icon } from './icons.mjs';
import { homeView, deviceView, calibrationView, gameView, resultsView } from './views.mjs';
import { createPlayfield } from './playfield.mjs';

const main = document.querySelector('#main');
const pauseDialog = document.querySelector('#pause-dialog');
const helpDialog = document.querySelector('#help-dialog');
const sound = createSound();
const state = { screen: 'home', players: 2, gentle: true, device: 'ready', calibrated: false, calibrating: false, calibrationMs: 0, countdownMs: 0, round: createRound() };
let field;
let toastMs = 0;
const views = { home: homeView, device: deviceView, calibration: calibrationView, game: gameView, results: resultsView };

function toast(message) {
  document.querySelector('#toast').textContent = message;
  toastMs = 4200;
}

function render(screen, focus = true) {
  field?.destroy();
  field = undefined;
  state.screen = screen;
  document.body.dataset.screen = screen;
  main.classList.toggle('gentle-game', state.gentle && screen === 'game');
  renderMarkup(main, views[screen](state));
  history.replaceState(null, '', '#' + screen);
  document.querySelector('#nav-home').classList.toggle('active', screen === 'home');
  if (screen === 'device') document.querySelector('#device-state').value = state.device;
  if (screen === 'game') {
    field = createPlayfield(document.querySelector('#game-field'), state.gentle, registerHit, registerMiss);
    updateScore();
  }
  if (focus) main.focus({ preventScroll: true });
}

function registerHit(id) {
  if (state.screen !== 'game' || state.countdownMs > 0) return false;
  const next = hit(state.round, id);
  if (next === state.round) return false;
  state.round = next;
  sound.play(480 + (state.round.combo % 7) * 65);
  updateScore();
  return true;
}

function registerMiss() {
  state.round = miss(state.round);
  updateScore();
}

function updateScore() {
  if (state.screen !== 'game') return;
  const round = state.round;
  document.querySelector('#score').textContent = round.score;
  document.querySelector('#time').textContent = Math.ceil(round.remainingMs / 1000);
  document.querySelector('#time-progress').style.width = (round.remainingMs / 600) + '%';
  document.querySelector('#combo-label').textContent = round.combo > 1
    ? round.combo + ' 连击 · 小手很厉害！'
    : (round.hits > 0 ? '拍得真棒！漏掉也没关系' : '挥挥鼠标，拍中第一个泡泡');
}

async function unlockSound() {
  const ready = await sound.unlock();
  if (!ready && sound.enabled) toast('声音暂时不可用，可以继续安静地玩。');
}

function beginRound(fresh) {
  if (fresh) state.round = createRound();
  else state.round = resumeRound(state.round);
  state.countdownMs = 3000;
  pauseDialog.close();
  if (fresh) render('game');
  else {
    document.querySelector('#countdown').hidden = false;
    document.querySelector('#countdown-number').textContent = '3';
    main.focus({ preventScroll: true });
    updateScore();
  }
  void unlockSound();
}

function pauseGame(reason = '时间和得分都为你保留着。') {
  if (state.screen !== 'game' || pauseDialog.open || state.round.phase !== 'playing') return;
  state.round = pauseRound(state.round);
  field?.setActive(false);
  document.querySelector('#pause-description').textContent = reason;
  pauseDialog.showModal();
}

function finishRound() {
  if (state.screen !== 'game') return;
  pauseDialog.close();
  state.round = endRound(state.round);
  state.countdownMs = 0;
  render('results');
}

function goHome() {
  if (state.screen === 'game') {
    pauseGame('先歇一歇。可以继续玩，或结束这一局后返回大厅。');
    return;
  }
  state.calibrating = false;
  state.calibrated = false;
  state.device = 'ready';
  helpDialog.close();
  render('home');
}

function prepareCalibration() {
  state.calibrated = false;
  state.calibrating = false;
  state.calibrationMs = 0;
  render('calibration');
}

function calibrate() {
  if (state.screen !== 'calibration' || state.calibrating) return;
  state.calibrated = false;
  state.calibrating = true;
  state.calibrationMs = 0;
  document.querySelector('#calibrate').disabled = true;
  document.querySelector('#start-round').disabled = true;
  document.querySelector('#calibration-ring').classList.remove('ready');
  document.querySelector('#calibration-status').textContent = '模拟举手中……保持一下下';
}

function calibrationTick(delta) {
  state.calibrationMs = Math.min(2000, state.calibrationMs + delta);
  document.querySelector('#calibration-progress').value = state.calibrationMs;
  if (state.calibrationMs < 2000) return;
  state.calibrating = false;
  state.calibrated = true;
  document.querySelector('#calibration-status').textContent = '准备好了，小手很棒！';
  document.querySelector('#calibration-ring').classList.add('ready');
  document.querySelector('#start-round').disabled = false;
  document.querySelector('#calibrate').disabled = false;
  document.querySelector('#calibrate').textContent = '重新模拟站位';
  sound.play(700);
}

function gameTick(delta) {
  if (state.round.phase !== 'playing') return;
  if (state.countdownMs > 0) {
    state.countdownMs = Math.max(0, state.countdownMs - delta);
    document.querySelector('#countdown-number').textContent = Math.max(1, Math.ceil(state.countdownMs / 1000));
    if (state.countdownMs === 0) {
      document.querySelector('#countdown').hidden = true;
      field?.setActive(true);
      sound.play(750);
    }
    return;
  }
  state.round = advanceRound(state.round, delta);
  if (state.round.phase === 'results') {
    render('results');
    return;
  }
  field?.update(delta);
  updateScore();
}

function tick(delta) {
  if (toastMs > 0) {
    toastMs -= delta;
    if (toastMs <= 0) document.querySelector('#toast').textContent = '';
  }
  if (document.hidden) return;
  if (state.screen === 'calibration' && state.calibrating) calibrationTick(delta);
  if (state.screen === 'game') gameTick(delta);
}

function setMode(players) {
  if (state.screen !== 'home') return;
  state.players = players;
  render('home', false);
  document.querySelector(players === 1 ? '#mode-solo' : '#mode-duo').focus({ preventScroll: true });
}

function toggleGentle() {
  if (state.screen !== 'home') return;
  state.gentle = !state.gentle;
  render('home', false);
  document.querySelector('#gentle-mode').focus({ preventScroll: true });
}

async function soundAction() {
  const enabled = sound.toggle();
  renderMarkup(document.querySelector('#sound-toggle'), icon(enabled ? 'sound' : 'mute'));
  document.querySelector('#sound-toggle').setAttribute('aria-label', enabled ? '关闭声音' : '开启声音');
  document.querySelector('#sound-toggle').setAttribute('aria-pressed', String(enabled));
  if (enabled) await unlockSound();
}

const actions = {
  home: goHome,
  solo: () => setMode(1),
  duo: () => setMode(2),
  gentle: toggleGentle,
  prepare: () => { state.device = 'ready'; render('device'); void unlockSound(); },
  calibration: prepareCalibration,
  calibrate,
  'start-round': () => { if (state.calibrated) beginRound(true); },
  again: () => beginRound(true),
  pause: () => pauseGame(),
  resume: () => beginRound(false),
  finish: finishRound,
  retry: () => { state.device = 'ready'; render('device'); },
  help: () => { pauseGame(); helpDialog.showModal(); },
  'close-help': () => helpDialog.close(),
  sound: soundAction,
  fullscreen: async () => {
    try { await toggleFullscreen(); }
    catch { toast('浏览器暂不支持全屏，可以使用系统的全屏按钮。'); }
  }
};

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = actions[button.dataset.action];
  if (action) void action();
});
document.addEventListener('change', event => {
  if (event.target.id !== 'device-state') return;
  state.device = ['ready', 'missing', 'denied'].includes(event.target.value) ? event.target.value : 'ready';
  render('device', false);
  document.querySelector('#device-state').focus({ preventScroll: true });
});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || state.screen !== 'game' || helpDialog.open || event.repeat) return;
  if (event.target.matches('button, input, select, textarea')) return;
  event.preventDefault();
  if (pauseDialog.open) beginRound(false);
  else pauseGame();
});
pauseDialog.addEventListener('cancel', event => {
  event.preventDefault();
  beginRound(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame('刚刚离开了画面，已经帮你暂停。准备好再继续。');
});
document.addEventListener('fullscreenchange', () => {
  document.querySelector('#fullscreen-toggle').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏');
});
window.addEventListener('hashchange', () => {
  if (state.screen === 'game') {
    history.replaceState(null, '', '#game');
    pauseGame();
    return;
  }
  const route = location.hash.slice(1);
  state.calibrating = false;
  state.calibrated = false;
  render(['home', 'device', 'calibration'].includes(route) ? route : 'home');
});
renderMarkup(document.querySelector('#sound-toggle'), icon('sound'));
renderMarkup(document.querySelector('#fullscreen-toggle'), icon('full'));
const initialRoute = location.hash.slice(1);
render(['home', 'device', 'calibration'].includes(initialRoute) ? initialRoute : 'home', false);
createFrameClock(tick).start();
