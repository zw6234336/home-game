export type HomeExitHooks = {
  hasActiveCapture: () => boolean;
  endGameSession: () => void;
  stopCameraAndVision: () => void;
  resetModeToLive: () => void;
  showHome: () => void;
  exitFullscreenIfActive: () => void;
  notifyCameraClosed: () => void;
};

export function exitSessionToHome(hooks: HomeExitHooks): { closedCamera: boolean } {
  const closedCamera = hooks.hasActiveCapture();
  hooks.endGameSession();
  hooks.stopCameraAndVision();
  hooks.resetModeToLive();
  hooks.showHome();
  hooks.exitFullscreenIfActive();
  if (closedCamera) hooks.notifyCameraClosed();
  return { closedCamera };
}
