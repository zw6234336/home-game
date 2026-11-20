import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Landmark, VisionConfig } from '../../types.ts';
import type { HandModel, ModelFactory, PoseModel } from '../inference-engine.ts';
import type { Delegate } from '../protocol.ts';
import { qualityProfile } from '../profiles.ts';

function landmarks(points: NormalizedLandmark[], mode: 'pose' | 'hand'): Landmark[] {
  return points.map(point => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { x: 0, y: 0, z: 0, visibility: 0 };
    return {
      x: point.x,
      y: point.y,
      z: Number.isFinite(point.z) ? point.z : 0,
      visibility: mode === 'hand' ? 1 : Number.isFinite(point.visibility) ? Math.max(0, Math.min(1, point.visibility)) : 0,
    };
  });
}

async function createOnCanvas<T extends { close(): void }>(create: (canvas: OffscreenCanvas) => Promise<T>) {
  const canvas = new OffscreenCanvas(1, 1);
  try {
    const task = await create(canvas);
    return {
      task,
      close() {
        try {
          task.close();
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      },
    };
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
}

export class MediaPipeModelFactory implements ModelFactory {
  private fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
  private loaderSequence = 0;

  private async resolveFileset() {
    this.fileset ??= FilesetResolver.forVisionTasks(new URL('/wasm', globalThis.location.href).href, true);
    const fileset = await this.fileset;
    const loader = new URL(fileset.wasmLoaderPath);
    loader.searchParams.set('instance', String(++this.loaderSequence));
    return { ...fileset, wasmLoaderPath: loader.href };
  }

  async createPose(config: VisionConfig, delegate: Delegate): Promise<PoseModel> {
    const model = await createOnCanvas(async canvas => PoseLandmarker.createFromOptions(await this.resolveFileset(), {
      baseOptions: { modelAssetPath: qualityProfile(config.quality).modelPath, delegate },
      canvas,
      runningMode: 'VIDEO',
      numPoses: config.numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    }));
    return {
      detect(image, timestamp) {
        const result = model.task.detectForVideo(image, timestamp);
        try {
          return result.landmarks.map(points => ({ landmarks: landmarks(points, 'pose') }));
        } finally {
          result.close();
        }
      },
      close: model.close,
    };
  }

  async createHands(delegate: Delegate): Promise<HandModel> {
    const model = await createOnCanvas(async canvas => HandLandmarker.createFromOptions(await this.resolveFileset(), {
      baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
      canvas,
      runningMode: 'VIDEO',
      numHands: 4,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }));
    return {
      detect(image, timestamp) {
        const result = model.task.detectForVideo(image, timestamp);
        return result.landmarks.slice(0, 4).map((points, index) => ({
          landmarks: landmarks(points, 'hand'),
          handedness: result.handedness[index]?.[0]?.categoryName ?? 'Unknown',
        }));
      },
      close: model.close,
    };
  }
}
