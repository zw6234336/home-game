import type { HandObservation, PoseObservation, VisionConfig } from '../types.ts';
import type { Delegate, FrameRequest, InferenceResult } from './protocol.ts';
import { checkedConfig } from './profiles.ts';

export interface PoseModel {
  detect(image: ImageBitmap, timestamp: number): PoseObservation[];
  close(): void;
}

export interface HandModel {
  detect(image: ImageBitmap, timestamp: number): HandObservation[];
  close(): void;
}

export interface ModelFactory {
  createPose(config: VisionConfig, delegate: Delegate): Promise<PoseModel>;
  createHands(delegate: Delegate): Promise<HandModel>;
}

type Models = { pose: PoseModel; hands: HandModel | null; delegate: Delegate };

function release(resource: { close(): void } | null): void {
  try {
    resource?.close();
  } catch {
    return;
  }
}

function releaseModels(models: Models | null): void {
  if (!models) return;
  release(models.pose);
  release(models.hands);
}

function cancelled(): Error {
  const error = new Error('视觉任务已取消');
  error.name = 'AbortError';
  return error;
}

export class InferenceEngine {
  private readonly factory: ModelFactory;
  private readonly now: () => number;
  private version = 0;
  private generation = -1;
  private disposed = true;
  private models: Models | null = null;
  private config: VisionConfig | null = null;
  private inFlight: object | null = null;
  private lastTimestamp = -Infinity;
  private lastHandsAt = -Infinity;

  constructor(factory: ModelFactory, now: () => number) {
    this.factory = factory;
    this.now = now;
  }

  async initialize(config: VisionConfig, generation: number): Promise<Delegate | null> {
    const nextConfig = checkedConfig(config);
    this.dispose();
    this.disposed = false;
    this.generation = generation;
    this.config = nextConfig;
    const version = this.version;
    try {
      let models: Models;
      try {
        models = await this.createModels(nextConfig, 'GPU', version);
      } catch (gpuError) {
        this.assertCurrent(version);
        try {
          models = await this.createModels(nextConfig, 'CPU', version);
        } catch (cpuError) {
          this.assertCurrent(version);
          throw new Error('本地视觉模型初始化失败，GPU 和 CPU 均不可用', { cause: new AggregateError([gpuError, cpuError]) });
        }
      }
      if (!this.isCurrent(version)) {
        releaseModels(models);
        return null;
      }
      this.models = models;
      return models.delegate;
    } catch (error) {
      if (!this.isCurrent(version)) return null;
      this.dispose();
      throw error;
    }
  }

  async infer(request: FrameRequest): Promise<InferenceResult | null> {
    if (this.disposed || !this.models || request.generation !== this.generation || this.inFlight) {
      release(request.bitmap);
      return null;
    }
    const flight = {};
    const version = this.version;
    this.inFlight = flight;
    const startedAt = this.now();
    try {
      if (!Number.isFinite(request.capturedAt) || request.capturedAt < 0 || !Number.isFinite(request.token)) throw new RangeError('无效的视觉帧时间或令牌');
      if (request.hands && !this.models.hands) await this.ensureHands(version);
      this.assertCurrent(version);
      const models = this.models;
      if (!models) return null;
      const timestamp = Math.max(request.capturedAt, this.lastTimestamp + 0.001);
      this.lastTimestamp = timestamp;
      const poses = models.pose.detect(request.bitmap, timestamp);
      let hands: HandObservation[] = [];
      let handsCapturedAt = 0;
      if (request.hands && models.hands && request.capturedAt - this.lastHandsAt >= 1000 / 12) {
        hands = models.hands.detect(request.bitmap, timestamp);
        handsCapturedAt = request.capturedAt;
        this.lastHandsAt = request.capturedAt;
      }
      this.assertCurrent(version);
      return { poses, hands, handsCapturedAt, inferenceMs: Math.max(0, this.now() - startedAt), delegate: models.delegate };
    } catch (error) {
      if (!this.isCurrent(version)) return null;
      throw error;
    } finally {
      release(request.bitmap);
      if (this.inFlight === flight) this.inFlight = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.version++;
    const models = this.models;
    this.models = null;
    this.config = null;
    this.inFlight = null;
    this.lastTimestamp = -Infinity;
    this.lastHandsAt = -Infinity;
    releaseModels(models);
  }

  private isCurrent(version: number): boolean {
    return !this.disposed && version === this.version;
  }

  private assertCurrent(version: number): void {
    if (!this.isCurrent(version)) throw cancelled();
  }

  private async createModels(config: VisionConfig, delegate: Delegate, version: number): Promise<Models> {
    let pose: PoseModel | null = null;
    let hands: HandModel | null = null;
    try {
      pose = await this.factory.createPose(config, delegate);
      this.assertCurrent(version);
      if (config.hands) {
        hands = await this.factory.createHands(delegate);
        this.assertCurrent(version);
      }
      return { pose, hands, delegate };
    } catch (error) {
      release(pose);
      release(hands);
      throw error;
    }
  }

  private async ensureHands(version: number): Promise<void> {
    const current = this.models;
    const config = this.config;
    if (!current || !config) throw cancelled();
    let hands: HandModel | null = null;
    try {
      hands = await this.factory.createHands(current.delegate);
      this.assertCurrent(version);
      current.hands = hands;
    } catch (error) {
      release(hands);
      this.assertCurrent(version);
      if (current.delegate === 'CPU') throw new Error('本地手部模型初始化失败', { cause: error });
      const replacement = await this.createModels({ ...config, hands: true }, 'CPU', version);
      if (!this.isCurrent(version)) {
        releaseModels(replacement);
        throw cancelled();
      }
      this.models = replacement;
      releaseModels(current);
    }
  }
}
