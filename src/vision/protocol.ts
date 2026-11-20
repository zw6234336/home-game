import type { HandObservation, PoseObservation, VisionConfig } from '../types.ts';

export type Delegate = 'GPU' | 'CPU';
export type FrameRequest = {
  type: 'frame';
  generation: number;
  token: number;
  capturedAt: number;
  hands: boolean;
  bitmap: ImageBitmap;
};
export type WorkerRequest =
  | { type: 'initialize'; generation: number; config: VisionConfig }
  | FrameRequest
  | { type: 'dispose' };
export type InferenceResult = {
  poses: PoseObservation[];
  hands: HandObservation[];
  handsCapturedAt: number;
  inferenceMs: number;
  delegate: Delegate;
};
export type WorkerResponse =
  | { type: 'ready'; generation: number; delegate: Delegate }
  | ({ type: 'result'; generation: number; token: number } & InferenceResult)
  | { type: 'dropped'; generation: number; token: number }
  | { type: 'error'; generation: number; message: string; token?: number }
  | { type: 'disposed' };
