import type { CropRect, Quality, VisionConfig } from '../types.ts';

export type QualityProfile = { longEdge: number; framesPerSecond: number; modelPath: string };

const profiles: Record<Quality, QualityProfile> = {
  quality: { longEdge: 960, framesPerSecond: 30, modelPath: '/models/pose_landmarker_full.task' },
  balanced: { longEdge: 640, framesPerSecond: 24, modelPath: '/models/pose_landmarker_lite.task' },
  fast: { longEdge: 480, framesPerSecond: 20, modelPath: '/models/pose_landmarker_lite.task' },
};

export function qualityProfile(quality: Quality): QualityProfile {
  if (!Object.hasOwn(profiles, quality)) throw new RangeError('未知的识别质量档位');
  return { ...profiles[quality] };
}

export function checkedConfig(config: VisionConfig): VisionConfig {
  qualityProfile(config.quality);
  if (config.numPoses !== 1 && config.numPoses !== 2) throw new RangeError('识别人数必须为一人或两人');
  if (typeof config.hands !== 'boolean') throw new TypeError('手部识别开关必须为布尔值');
  return { ...config };
}

export function checkedCrop(crop: CropRect): CropRect {
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new RangeError('裁剪区域必须位于源画面内，且宽高大于零');
  }
  return { x, y, width, height };
}

export function captureGeometry(videoWidth: number, videoHeight: number, crop: CropRect, longEdge: number) {
  checkedCrop(crop);
  if (![videoWidth, videoHeight, longEdge].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('画面尺寸必须是正有限数值');
  const sourceWidth = crop.width * videoWidth;
  const sourceHeight = crop.height * videoHeight;
  const scale = Math.min(1, longEdge / Math.max(sourceWidth, sourceHeight));
  return {
    sourceX: crop.x * videoWidth,
    sourceY: crop.y * videoHeight,
    sourceWidth,
    sourceHeight,
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
