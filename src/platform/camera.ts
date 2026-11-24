import type { CropRect } from '../types.ts';

export type CropPreset = 'left' | 'right' | 'left-near' | 'full';

export function isWideStereoFrame(videoWidth: number, videoHeight: number): boolean {
  return Number.isFinite(videoWidth) && Number.isFinite(videoHeight) && videoWidth > 0 && videoHeight > 0 && videoWidth / videoHeight >= 2.6;
}

export function isOv580StereoFrame(videoWidth: number, videoHeight: number): boolean {
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0) return false;
  const eyeHeight = videoHeight >= 400 ? videoHeight - 8 : videoHeight;
  const eyeWidth = Math.round(eyeHeight * 1.6);
  return eyeWidth >= 320 && videoWidth / videoHeight >= 3.8 && 48 + eyeWidth * 2 < videoWidth && Math.abs(videoWidth - (48 + eyeWidth * 2 + Math.round(eyeWidth * 0.65625))) <= 8;
}

export function stereoCropPreset(videoWidth: number, videoHeight: number, preset: CropPreset): CropRect {
  if (preset === 'full' || !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const aspect = videoWidth / videoHeight;
  let eye: CropRect = { x: 0, y: 0, width: 1, height: 1 };
  if (aspect >= 3.8) {
    const eyeHeight = videoHeight >= 400 ? videoHeight - 8 : videoHeight;
    const eyeWidth = Math.round(eyeHeight * 1.6);
    if (48 + eyeWidth * 2 <= videoWidth) {
      const startX = preset === 'right' ? 48 + eyeWidth : 48;
      eye = { x: startX / videoWidth, y: 0, width: eyeWidth / videoWidth, height: eyeHeight / videoHeight };
    } else {
      eye = preset === 'right' ? { x: 0.5, y: 0, width: 0.5, height: 1 } : { x: 0, y: 0, width: 0.5, height: 1 };
    }
  } else if (aspect >= 2.4) {
    eye = preset === 'right' ? { x: 0.5, y: 0, width: 0.5, height: 1 } : { x: 0, y: 0, width: 0.5, height: 1 };
  }
  if (preset !== 'left-near') return eye;
  const zoom = 0.75;
  const width = eye.width * zoom;
  const height = eye.height * zoom;
  return { x: eye.x + (eye.width - width) / 2, y: eye.y + (eye.height - height) / 2, width, height };
}

export class CameraSession {
  readonly video = document.createElement('video');
  private stream: MediaStream | null = null;
  private generation = 0;
  private ended: () => void;
  constructor(onEnded: () => void) {
    this.ended = onEnded;
    this.video.muted = true;
    this.video.playsInline = true;
  }
  async start(deviceId?: string) {
    this.stop();
    const generation = this.generation;
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('请通过 localhost 或可信 HTTPS 打开，浏览器才能使用摄像头。');
    const baseConstraints: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { ...baseConstraints, deviceId: { exact: deviceId } } : baseConstraints });
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
    const track = stream.getVideoTracks()[0];
    if (track && typeof track.getCapabilities === 'function' && typeof track.applyConstraints === 'function') {
      try {
        const capabilities = track.getCapabilities();
        const maxWidth = capabilities.width?.max ?? 0;
        const maxHeight = capabilities.height?.max ?? 0;
        const currentHeight = track.getSettings?.().height ?? 0;
        if (isWideStereoFrame(maxWidth, maxHeight) && currentHeight < Math.min(808, maxHeight)) {
          await track.applyConstraints({ width: { ideal: maxWidth }, height: { ideal: maxHeight }, frameRate: { ideal: 30, max: 60 } });
        }
      } catch {
      }
      if (generation !== this.generation) { stream.getTracks().forEach(item => item.stop()); return false; }
    }
    this.stream = stream;
    this.video.srcObject = stream;
    try { await this.video.play(); } catch (error) { if (generation === this.generation) this.stop(); else stream.getTracks().forEach(track => track.stop()); throw error; }
    if (generation !== this.generation) return false;
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', this.ended));
    return true;
  }
  async devices() { return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput'); }
  get settings() { return this.stream?.getVideoTracks()[0]?.getSettings() ?? {}; }
  get active() { return this.stream?.getVideoTracks().some(track => track.readyState === 'live') ?? false; }
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach(track => { track.removeEventListener('ended', this.ended); track.stop(); });
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
  }
}

export function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  const labels: Record<string, string> = {
    NotAllowedError: '摄像头没有获准使用。请在浏览器地址栏允许摄像头，再点击重试。',
    NotFoundError: '没有找到可用摄像头。检查 PS4 摄像头的 USB 3.0 连接与系统固件加载。',
    NotReadableError: '摄像头可能被其他程序占用。关闭使用它的程序后重试。',
    OverconstrainedError: '设备不支持当前采集条件，请重新选择摄像头。',
    AbortError: '连接已中断，请重新连接摄像头。'
  };
  return labels[name] ?? (error instanceof Error ? error.message : '摄像头连接失败，请重试。');
}
