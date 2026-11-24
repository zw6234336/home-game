import type { CropRect, VisionConfig, VisionFrame, VisionStats, VisionStatus } from '../types.ts';
import { FrameGate } from './frame-gate.ts';
import { captureGeometry, checkedConfig, checkedCrop, qualityProfile } from './profiles.ts';
import type { WorkerResponse } from './protocol.ts';
import { browserVisionRuntime, retireWorker } from './platform/runtime.ts';
import type { VisionRuntime, VisionWorker } from './platform/runtime.ts';

type Callbacks = {
  onFrame: (frame: VisionFrame) => void;
  onStatus: (status: VisionStatus) => void;
  onError: (error: Error) => void;
};
type PendingFrame = {
  generation: number;
  cropRevision: number;
  handsRevision: number;
  token: number;
  sequence: number;
  capturedAt: number;
  hands: boolean;
};
type Startup = { resolve: () => void; reject: (error: Error) => void };

function initialStats(): VisionStats {
  return { captured: 0, submitted: 0, dropped: 0, completed: 0, inferenceMs: 0, ageMs: 0, delegate: null };
}

function abortError(): Error {
  const error = new Error('视觉初始化已取消');
  error.name = 'AbortError';
  return error;
}

export class VisionPipeline {
  private readonly callbacks: Callbacks;
  private readonly runtime: VisionRuntime;
  private readonly gate = new FrameGate();
  private generation = 0;
  private cropRevision = 0;
  private handsRevision = 0;
  private worker: VisionWorker | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private config: VisionConfig | null = null;
  private crop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
  private ready = false;
  private pending: PendingFrame | null = null;
  private startup: Startup | null = null;
  private cancelFrame: (() => void) | null = null;
  private cancelStartupDeadline: (() => void) | null = null;
  private lastMediaTime = -Infinity;
  private lastCapturedAt = -Infinity;
  private statistics = initialStats();

  constructor(callbacks: Callbacks, runtime: VisionRuntime = browserVisionRuntime()) {
    this.callbacks = callbacks;
    this.runtime = runtime;
  }

  get stats(): VisionStats {
    return { ...this.statistics };
  }

  async start(video: HTMLVideoElement, config: VisionConfig, crop: CropRect): Promise<void> {
    const nextConfig = checkedConfig(config);
    const nextCrop = checkedCrop(crop);
    this.endSession();
    const generation = this.generation;
    this.video = video;
    this.config = nextConfig;
    this.crop = nextCrop;
    this.statistics = initialStats();
    this.callbacks.onStatus({ state: 'loading', delegate: null, message: '正在加载本地姿态识别模型' });
    if (generation !== this.generation) throw abortError();
    const initialized = new Promise<void>((resolve, reject) => {
      this.startup = { resolve, reject };
    });
    try {
      this.canvas = this.runtime.createCanvas();
      this.context = this.canvas.getContext('2d', { alpha: false });
      if (!this.context) throw new Error('当前浏览器无法创建视频裁剪画布');
      const worker = this.runtime.createWorker();
      this.worker = worker;
      worker.onmessage = event => this.receive(event.data, worker, generation);
      worker.onerror = event => {
        event.preventDefault();
        if (this.isCurrent(worker, generation)) this.fail(new Error(event.message || '本地视觉 Worker 运行失败'));
      };
      worker.onmessageerror = () => {
        if (this.isCurrent(worker, generation)) this.fail(new Error('无法读取本地视觉 Worker 的识别结果'));
      };
      this.cancelStartupDeadline = this.runtime.deadline(() => {
        if (this.isCurrent(worker, generation)) this.fail(new Error('本地视觉模型加载超时，请检查本地模型资源后重试'));
      }, 45000);
      worker.postMessage({ type: 'initialize', generation, config: nextConfig });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
    return initialized;
  }

  stop(): void {
    this.endSession();
    this.callbacks.onStatus({ state: 'stopped', delegate: null, message: '视觉识别已停止' });
  }

  setCrop(crop: CropRect): void {
    this.crop = checkedCrop(crop);
    this.cropRevision++;
    this.gate.reset();
    this.lastCapturedAt = -Infinity;
  }

  setHands(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('手部识别开关必须为布尔值');
    if (this.config && enabled !== this.config.hands) {
      this.config.hands = enabled;
      this.handsRevision++;
    }
  }

  private isCurrent(worker: VisionWorker, generation: number): boolean {
    return worker === this.worker && generation === this.generation;
  }

  private receive(message: WorkerResponse, worker: VisionWorker, generation: number): void {
    if (!this.isCurrent(worker, generation) || message.type === 'disposed' || message.generation !== generation) return;
    if (message.type === 'error') {
      this.fail(new Error(message.message));
      return;
    }
    if (message.type === 'ready') {
      if (this.ready) return;
      this.cancelStartupDeadline?.();
      this.cancelStartupDeadline = null;
      this.ready = true;
      this.statistics.delegate = message.delegate;
      const startup = this.startup;
      this.startup = null;
      this.schedule(generation);
      startup?.resolve();
      this.callbacks.onStatus({ state: 'ready', delegate: message.delegate, message: message.delegate === 'GPU' ? '本地 GPU 视觉识别已就绪' : '已使用本地 CPU 视觉识别' });
      return;
    }
    const pending = this.pending;
    if (!pending || message.token !== pending.token) return;
    this.pending = null;
    const completedAt = this.runtime.now();
    const accepted = this.gate.complete(pending.token, pending.capturedAt, completedAt);
    const ageMs = completedAt - pending.capturedAt;
    this.statistics.ageMs = Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0;
    if (message.type === 'dropped' || !accepted || pending.cropRevision !== this.cropRevision) {
      this.statistics.dropped++;
      if (message.type === 'result' && Number.isFinite(message.inferenceMs)) this.statistics.inferenceMs = message.inferenceMs;
      this.callbacks.onStatus({ state: 'ready', delegate: this.statistics.delegate, message: '已丢弃过期或裁剪前的识别帧' });
      return;
    }
    if (!Number.isFinite(message.inferenceMs) || message.inferenceMs < 0) {
      this.statistics.dropped++;
      this.fail(new Error('视觉 Worker 返回了无效的推理耗时'));
      return;
    }
    const useHands = this.config?.hands && pending.hands && pending.handsRevision === this.handsRevision && message.handsCapturedAt === pending.capturedAt;
    this.statistics.completed++;
    this.statistics.inferenceMs = message.inferenceMs;
    const delegateChanged = this.statistics.delegate !== message.delegate;
    this.statistics.delegate = message.delegate;
    if (delegateChanged) this.callbacks.onStatus({ state: 'ready', delegate: message.delegate, message: '视觉识别已切换到本地 CPU' });
    if (!this.isCurrent(worker, generation)) return;
    this.callbacks.onFrame({
      sequence: pending.sequence,
      capturedAt: pending.capturedAt,
      completedAt,
      inferenceMs: message.inferenceMs,
      poses: message.poses,
      hands: useHands ? message.hands : [],
      handsCapturedAt: useHands ? message.handsCapturedAt : 0,
    });
  }

  private schedule(generation: number): void {
    const video = this.video;
    if (!video || !this.ready || generation !== this.generation) return;
    this.cancelFrame = this.runtime.scheduleFrame(video, mediaTime => {
      this.cancelFrame = null;
      if (generation !== this.generation || !this.ready) return;
      const now = this.runtime.now();
      const fresh = Number.isFinite(mediaTime) && mediaTime !== this.lastMediaTime;
      if (fresh) this.lastMediaTime = mediaTime;
      const config = this.config;
      if (fresh && config && !this.pending && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && now - this.lastCapturedAt >= 1000 / qualityProfile(config.quality).framesPerSecond) {
        void this.capture(generation, now);
      }
      this.schedule(generation);
    });
  }

  private async capture(generation: number, capturedAt: number): Promise<void> {
    const video = this.video;
    const canvas = this.canvas;
    const context = this.context;
    const worker = this.worker;
    const config = this.config;
    if (!video || !canvas || !context || !worker || !config || this.pending) return;
    const token = this.gate.begin(capturedAt);
    if (token === null) return;
    const pending: PendingFrame = { generation, cropRevision: this.cropRevision, handsRevision: this.handsRevision, token, sequence: ++this.statistics.captured, capturedAt, hands: config.hands };
    this.pending = pending;
    this.lastCapturedAt = capturedAt;
    let bitmap: ImageBitmap | null = null;
    try {
      const dimensions = captureGeometry(video.videoWidth, video.videoHeight, this.crop, qualityProfile(config.quality).longEdge);
      if (canvas.width !== dimensions.width) canvas.width = dimensions.width;
      if (canvas.height !== dimensions.height) canvas.height = dimensions.height;
      if (typeof context.filter === 'string') context.filter = 'contrast(1.08) brightness(1.03)';
      context.drawImage(video, dimensions.sourceX, dimensions.sourceY, dimensions.sourceWidth, dimensions.sourceHeight, 0, 0, dimensions.width, dimensions.height);
      bitmap = await this.runtime.createBitmap(canvas);
      if (!this.isCurrent(worker, generation) || this.pending !== pending) return;
      const now = this.runtime.now();
      if (pending.cropRevision !== this.cropRevision || !Number.isFinite(now) || now < capturedAt || now - capturedAt > 150) {
        this.pending = null;
        this.gate.complete(token, capturedAt, now);
        this.statistics.dropped++;
        this.callbacks.onStatus({ state: 'ready', delegate: this.statistics.delegate, message: '已丢弃过期或裁剪前的视频帧' });
        return;
      }
      worker.postMessage({ type: 'frame', generation, token, capturedAt, hands: pending.hands, bitmap }, [bitmap]);
      bitmap = null;
      this.statistics.submitted++;
    } catch (error) {
      if (this.isCurrent(worker, generation) && this.pending === pending) {
        this.pending = null;
        this.gate.complete(token, capturedAt, this.runtime.now());
        this.statistics.dropped++;
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      bitmap?.close();
    }
  }

  private endSession(error: Error = abortError()): void {
    this.generation++;
    this.ready = false;
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.cancelStartupDeadline?.();
    this.cancelStartupDeadline = null;
    const startup = this.startup;
    this.startup = null;
    startup?.reject(error);
    const worker = this.worker;
    this.worker = null;
    if (worker) retireWorker(worker, this.runtime);
    this.gate.reset();
    this.pending = null;
    this.video = null;
    this.config = null;
    this.context = null;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas = null;
    }
    this.lastMediaTime = -Infinity;
    this.lastCapturedAt = -Infinity;
  }

  private fail(error: Error): void {
    this.endSession(error);
    this.callbacks.onStatus({ state: 'stopped', delegate: null, message: '视觉识别已停止，请检查设备后重试' });
    this.callbacks.onError(error);
  }
}
