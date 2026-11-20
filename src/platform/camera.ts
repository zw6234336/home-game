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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId }, frameRate: { ideal: 30, max: 60 } } : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } } });
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
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
