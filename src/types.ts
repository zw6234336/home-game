export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type CropRect = Rect;
export type Landmark = Point & { z?: number; visibility: number };
export type PoseObservation = { landmarks: Landmark[] };
export type HandObservation = { landmarks: Landmark[]; handedness: string };
export type Quality = 'quality' | 'balanced' | 'fast';
export type VisionConfig = { quality: Quality; numPoses: 1 | 2; hands: boolean };
export type VisionFrame = {
  sequence: number;
  capturedAt: number;
  completedAt: number;
  inferenceMs: number;
  poses: PoseObservation[];
  hands: HandObservation[];
  handsCapturedAt: number;
};
export type VisionStatus = { state: 'loading' | 'ready' | 'stopped'; delegate: 'GPU' | 'CPU' | null; message: string };
export type VisionStats = { captured: number; submitted: number; dropped: number; completed: number; inferenceMs: number; ageMs: number; delegate: 'GPU' | 'CPU' | null };
export type StereoMeasurement = {
  depthMeters: number | null;
  depthConfidence: number;
  realShoulderMeters: number | null;
  disparityPx: number | null;
  appearance: number[] | null;
};
export type TrackedPlayer = {
  id: number;
  center: Point;
  shoulderWidth: number;
  landmarks: Landmark[];
  wrists: [Point | null, Point | null];
  raised: boolean;
  bothRaised: boolean;
  depthMeters?: number | null;
  depthConfidence?: number;
  realShoulderMeters?: number | null;
};
export type ReachZone = Rect & { playerId: number };
