import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitSessionToHome } from '../src/platform/session-lifecycle.ts';

test('exitSessionToHome stops active capture, clears session before exiting fullscreen, and notifies', () => {
  const order: string[] = [];
  const res = exitSessionToHome({
    hasActiveCapture: () => true,
    endGameSession: () => order.push('endGameSession'),
    stopCameraAndVision: () => order.push('stopCameraAndVision'),
    resetModeToLive: () => order.push('resetModeToLive'),
    showHome: () => order.push('showHome'),
    exitFullscreenIfActive: () => order.push('exitFullscreenIfActive'),
    notifyCameraClosed: () => order.push('notifyCameraClosed'),
  });

  assert.equal(res.closedCamera, true);
  assert.deepEqual(order, [
    'endGameSession',
    'stopCameraAndVision',
    'resetModeToLive',
    'showHome',
    'exitFullscreenIfActive',
    'notifyCameraClosed',
  ]);
});

test('exitSessionToHome skips camera-closed toast when leaving demo or idle mode while still resetting state', () => {
  const order: string[] = [];
  const res = exitSessionToHome({
    hasActiveCapture: () => false,
    endGameSession: () => order.push('endGameSession'),
    stopCameraAndVision: () => order.push('stopCameraAndVision'),
    resetModeToLive: () => order.push('resetModeToLive'),
    showHome: () => order.push('showHome'),
    exitFullscreenIfActive: () => order.push('exitFullscreenIfActive'),
    notifyCameraClosed: () => order.push('notifyCameraClosed'),
  });

  assert.equal(res.closedCamera, false);
  assert.deepEqual(order, [
    'endGameSession',
    'stopCameraAndVision',
    'resetModeToLive',
    'showHome',
    'exitFullscreenIfActive',
  ]);
});
