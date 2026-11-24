import type { CropRect, Landmark, PoseObservation, StereoMeasurement } from '../types.ts';
import { isOv580StereoFrame } from '../platform/camera.ts';
import { validLandmark } from '../interaction/geometry.ts';

export type StereoLayout = {
  leftX: number;
  rightX: number;
  eyeWidth: number;
  eyeHeight: number;
  focalRatio: number;
  baselineMeters: number;
};

export type StereoMatchResult = {
  disparityPx: number;
  confidence: number;
  depthMeters: number;
};

export type StereoBuffer = {
  width: number;
  height: number;
  lumaA: Uint8Array;
  lumaB: Uint8Array;
  rgbaA: Uint8ClampedArray;
  rgbaB: Uint8ClampedArray;
};

const BUFFER_WIDTH = 240;
const BUFFER_HEIGHT = 150;
const MAX_DISPARITY = 36;
const MIN_DISPARITY = 1.2;
const PATCH_RADIUS = 8;
const PATCH_STEP = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeStereoLayout(videoWidth: number, videoHeight: number): StereoLayout | null {
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) || videoWidth <= 0 || videoHeight <= 0) return null;
  if (isOv580StereoFrame(videoWidth, videoHeight)) {
    const eyeHeight = videoHeight >= 400 ? videoHeight - 8 : videoHeight;
    const eyeWidth = Math.round(eyeHeight * 1.6);
    return { leftX: 48, rightX: 48 + eyeWidth, eyeWidth, eyeHeight, focalRatio: 0.545, baselineMeters: 0.085 };
  }
  const aspect = videoWidth / videoHeight;
  if (aspect >= 2.4 && aspect < 3.8) {
    const eyeWidth = Math.floor(videoWidth / 2);
    return { leftX: 0, rightX: eyeWidth, eyeWidth, eyeHeight: videoHeight, focalRatio: 0.6, baselineMeters: 0.085 };
  }
  return null;
}

export function rgbaToLuma(rgba: Uint8ClampedArray, out: Uint8Array): void {
  const count = out.length;
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    out[i] = (rgba[base] * 77 + rgba[base + 1] * 150 + rgba[base + 2] * 29) >> 8;
  }
}

function patchZncc(
  primary: Uint8Array,
  companion: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  let count = 0;
  const maxX = width - 1;
  const maxY = height - 1;
  for (let oy = -PATCH_RADIUS; oy <= PATCH_RADIUS; oy += PATCH_STEP) {
    const yA = cy + oy;
    const yB = yA + dy;
    if (yA < 0 || yA > maxY || yB < 0 || yB > maxY) continue;
    const rowA = yA * width;
    const rowB = yB * width;
    for (let ox = -PATCH_RADIUS; ox <= PATCH_RADIUS; ox += PATCH_STEP) {
      const xA = cx + ox;
      const xB = xA + dx;
      if (xA < 0 || xA > maxX || xB < 0 || xB > maxX) continue;
      const a = primary[rowA + xA];
      const b = companion[rowB + xB];
      sumA += a;
      sumB += b;
      sumAA += a * a;
      sumBB += b * b;
      sumAB += a * b;
      count += 1;
    }
  }
  if (count < 25) return -1;
  const inv = 1 / count;
  const varA = sumAA - sumA * sumA * inv;
  const varB = sumBB - sumB * sumB * inv;
  if (varA < 300 || varB < 300) return -1;
  return (sumAB - sumA * sumB * inv) / Math.sqrt(varA * varB);
}

export function matchDisparityZncc(
  primary: Uint8Array,
  companion: Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
  focalRatio: number,
  baselineMeters: number,
  preferredSign: -1 | 0 | 1 = 0,
): StereoMatchResult | null {
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0.04 || u > 0.96 || v < 0.06 || v > 0.94) return null;
  const cx = Math.round(u * (width - 1));
  const cy = Math.round(v * (height - 1));
  const minD = preferredSign > 0 ? 1 : -MAX_DISPARITY;
  const maxD = preferredSign < 0 ? -1 : MAX_DISPARITY;
  let bestScore = -1;
  let bestD = 0;
  let bestDy = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let d = minD; d <= maxD; d += 1) {
      if (d === 0) continue;
      if (cx + d - PATCH_RADIUS < 0 || cx + d + PATCH_RADIUS >= width) continue;
      const score = patchZncc(primary, companion, width, height, cx, cy, d, dy);
      if (score > bestScore) {
        bestScore = score;
        bestD = d;
        bestDy = dy;
      }
    }
  }
  if (bestScore < 0.5 || bestD === 0) return null;
  const prevScore = bestD - 1 !== 0 ? patchZncc(primary, companion, width, height, cx, cy, bestD - 1, bestDy) : bestScore;
  const nextScore = bestD + 1 !== 0 ? patchZncc(primary, companion, width, height, cx, cy, bestD + 1, bestDy) : bestScore;
  const denom = prevScore - 2 * bestScore + nextScore;
  const subOffset = Math.abs(denom) > 1e-6 && prevScore > -0.5 && nextScore > -0.5
    ? clamp((prevScore - nextScore) / (2 * denom), -0.5, 0.5)
    : 0;
  const disparityPx = bestD + subOffset;
  const absDisparity = Math.abs(disparityPx);
  if (absDisparity < MIN_DISPARITY) return null;
  const focalPx = width * focalRatio;
  const depthMeters = clamp((baselineMeters * focalPx) / absDisparity, 0.45, 6.0);
  return { disparityPx, confidence: clamp(bestScore, 0, 1), depthMeters };
}

export function extractTorsoColorSignature(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number,
  halfW: number,
  halfH: number,
): number[] | null {
  if (!Number.isFinite(u) || !Number.isFinite(v) || !Number.isFinite(halfW) || !Number.isFinite(halfH)) return null;
  const x0 = Math.max(0, Math.floor((u - halfW) * width));
  const x1 = Math.min(width - 1, Math.ceil((u + halfW) * width));
  const y0 = Math.max(0, Math.floor((v - halfH) * height));
  const y1 = Math.min(height - 1, Math.ceil((v + halfH) * height));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  const bins = new Array<number>(12).fill(0);
  const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
  let total = 0;
  for (let y = y0; y <= y1; y += stepY) {
    const row = y * width;
    for (let x = x0; x <= x1; x += stepX) {
      const idx = (row + x) * 4;
      const r = rgba[idx] / 255;
      const g = rgba[idx + 1] / 255;
      const b = rgba[idx + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const light = (max + min) * 0.5;
      const sat = delta < 1e-4 ? 0 : delta / (1 - Math.abs(2 * light - 1));
      if (sat < 0.18 || delta < 0.06) {
        const lBin = Math.min(3, Math.floor(light * 4));
        bins[8 + lBin] += 1;
      } else {
        let hue = 0;
        if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        else if (max === g) hue = ((b - r) / delta + 2) / 6;
        else hue = ((r - g) / delta + 4) / 6;
        const hBin = Math.min(7, Math.floor(hue * 8));
        bins[hBin] += 0.4 + sat * 0.6;
      }
      total += 1;
    }
  }
  if (total < 6) return null;
  let norm = 0;
  for (let i = 0; i < bins.length; i += 1) norm += bins[i] * bins[i];
  if (norm <= 1e-8) return null;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < bins.length; i += 1) bins[i] *= inv;
  return bins;
}

export function signatureSimilarity(first: readonly number[] | null | undefined, second: readonly number[] | null | undefined): number {
  if (!first || !second || first.length !== second.length || first.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < first.length; i += 1) dot += first[i] * second[i];
  return clamp(dot, 0, 1);
}

function poseChestSample(pose: PoseObservation): { x: number; y: number; shoulderWidth: number; torsoHeight: number } | null {
  if (!pose || !Array.isArray(pose.landmarks)) return null;
  const ls = pose.landmarks[11];
  const rs = pose.landmarks[12];
  const lh = pose.landmarks[23];
  const rh = pose.landmarks[24];
  const shouldersOk = validLandmark(ls) && validLandmark(rs);
  const hipsOk = validLandmark(lh) && validLandmark(rh);
  if (!shouldersOk && !hipsOk) return null;
  const sx = shouldersOk ? (ls.x + rs.x) / 2 : (lh.x + rh.x) / 2;
  const sy = shouldersOk ? (ls.y + rs.y) / 2 : (lh.y + rh.y) / 2;
  const shoulderWidth = shouldersOk ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : Math.hypot(lh.x - rh.x, lh.y - rh.y) * 1.2;
  const hy = hipsOk ? (lh.y + rh.y) / 2 : sy + Math.max(0.1, shoulderWidth * 1.1);
  const cy = shouldersOk && hipsOk ? sy + (hy - sy) * 0.38 : clamp(sy + shoulderWidth * 0.42, 0.08, 0.92);
  return { x: clamp(sx, 0.04, 0.96), y: clamp(cy, 0.08, 0.92), shoulderWidth: Math.max(0.025, shoulderWidth), torsoHeight: Math.max(0.06, Math.abs(hy - sy)) };
}

export function measurePoseFromBuffers(
  pose: PoseObservation,
  crop: CropRect,
  videoWidth: number,
  videoHeight: number,
  layout: StereoLayout | null,
  buffer: StereoBuffer,
  preferredSign: -1 | 0 | 1 = 0,
): StereoMeasurement {
  const sample = poseChestSample(pose);
  if (!sample) return { depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance: null };
  if (!layout) {
    const appearance = extractTorsoColorSignature(
      buffer.rgbaA,
      buffer.width,
      buffer.height,
      sample.x,
      sample.y,
      clamp(sample.shoulderWidth * 0.35, 0.025, 0.14),
      clamp(sample.torsoHeight * 0.28, 0.03, 0.16),
    );
    return { depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance };
  }
  const rawX = (crop.x + sample.x * crop.width) * videoWidth;
  const rawY = (crop.y + sample.y * crop.height) * videoHeight;
  const inLeft = rawX >= layout.leftX && rawX < layout.leftX + layout.eyeWidth;
  const inRight = rawX >= layout.rightX && rawX < layout.rightX + layout.eyeWidth;
  if (!inLeft && !inRight) {
    return { depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance: null };
  }
  const u = (rawX - (inLeft ? layout.leftX : layout.rightX)) / layout.eyeWidth;
  const v = clamp(rawY / layout.eyeHeight, 0.06, 0.94);
  const eyeScaleX = (crop.width * videoWidth) / layout.eyeWidth;
  const eyeScaleY = (crop.height * videoHeight) / layout.eyeHeight;
  const primaryLuma = inLeft ? buffer.lumaA : buffer.lumaB;
  const companionLuma = inLeft ? buffer.lumaB : buffer.lumaA;
  const primaryRgba = inLeft ? buffer.rgbaA : buffer.rgbaB;
  const effectiveSign: -1 | 0 | 1 = inLeft ? preferredSign : (preferredSign === 0 ? 0 : (-preferredSign as -1 | 1));
  const match = matchDisparityZncc(primaryLuma, companionLuma, buffer.width, buffer.height, u, v, layout.focalRatio, layout.baselineMeters, effectiveSign);
  const appearance = extractTorsoColorSignature(
    primaryRgba,
    buffer.width,
    buffer.height,
    u,
    v,
    clamp(sample.shoulderWidth * eyeScaleX * 0.35, 0.025, 0.14),
    clamp(sample.torsoHeight * eyeScaleY * 0.28, 0.03, 0.16),
  );
  if (!match) {
    return { depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance };
  }
  const shoulderInEye = sample.shoulderWidth * eyeScaleX;
  const realShoulderMeters = clamp((shoulderInEye * match.depthMeters) / layout.focalRatio, 0.12, 0.85);
  return {
    depthMeters: match.depthMeters,
    depthConfidence: match.confidence,
    realShoulderMeters,
    disparityPx: inLeft ? match.disparityPx : -match.disparityPx,
    appearance,
  };
}

export class StereoDepthAnalyzer {
  private canvasA: HTMLCanvasElement | null = null;
  private canvasB: HTMLCanvasElement | null = null;
  private ctxA: CanvasRenderingContext2D | null = null;
  private ctxB: CanvasRenderingContext2D | null = null;
  private lumaA = new Uint8Array(BUFFER_WIDTH * BUFFER_HEIGHT);
  private lumaB = new Uint8Array(BUFFER_WIDTH * BUFFER_HEIGHT);
  private polarityVotes = 0;
  private activeStereo = false;

  get stereoAvailable(): boolean {
    return this.activeStereo;
  }

  private ensureCanvases(): boolean {
    if (this.ctxA && this.ctxB) return true;
    if (typeof document === 'undefined') return false;
    this.canvasA = document.createElement('canvas');
    this.canvasB = document.createElement('canvas');
    this.canvasA.width = BUFFER_WIDTH;
    this.canvasA.height = BUFFER_HEIGHT;
    this.canvasB.width = BUFFER_WIDTH;
    this.canvasB.height = BUFFER_HEIGHT;
    this.ctxA = this.canvasA.getContext('2d', { alpha: false, willReadFrequently: true });
    this.ctxB = this.canvasB.getContext('2d', { alpha: false, willReadFrequently: true });
    return Boolean(this.ctxA && this.ctxB);
  }

  measure(video: HTMLVideoElement | null, crop: CropRect, poses: PoseObservation[]): StereoMeasurement[] {
    if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0 || poses.length === 0) {
      this.activeStereo = Boolean(video && computeStereoLayout(video.videoWidth, video.videoHeight));
      return poses.map(() => ({ depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance: null }));
    }
    const layout = computeStereoLayout(video.videoWidth, video.videoHeight);
    this.activeStereo = layout !== null;
    if (!this.ensureCanvases() || !this.ctxA || !this.ctxB) {
      return poses.map(() => ({ depthMeters: null, depthConfidence: 0, realShoulderMeters: null, disparityPx: null, appearance: null }));
    }
    let rgbaA: Uint8ClampedArray;
    let rgbaB: Uint8ClampedArray;
    if (layout) {
      this.ctxA.drawImage(video, layout.leftX, 0, layout.eyeWidth, layout.eyeHeight, 0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
      this.ctxB.drawImage(video, layout.rightX, 0, layout.eyeWidth, layout.eyeHeight, 0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
      rgbaA = this.ctxA.getImageData(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT).data;
      rgbaB = this.ctxB.getImageData(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT).data;
      rgbaToLuma(rgbaA, this.lumaA);
      rgbaToLuma(rgbaB, this.lumaB);
    } else {
      const sx = crop.x * video.videoWidth;
      const sy = crop.y * video.videoHeight;
      const sw = crop.width * video.videoWidth;
      const sh = crop.height * video.videoHeight;
      this.ctxA.drawImage(video, sx, sy, sw, sh, 0, 0, BUFFER_WIDTH, BUFFER_HEIGHT);
      rgbaA = this.ctxA.getImageData(0, 0, BUFFER_WIDTH, BUFFER_HEIGHT).data;
      rgbaB = rgbaA;
    }
    const preferredSign: -1 | 0 | 1 = this.polarityVotes >= 6 ? 1 : this.polarityVotes <= -6 ? -1 : 0;
    const buffer: StereoBuffer = { width: BUFFER_WIDTH, height: BUFFER_HEIGHT, lumaA: this.lumaA, lumaB: this.lumaB, rgbaA, rgbaB };
    const results = poses.map(pose => measurePoseFromBuffers(pose, crop, video.videoWidth, video.videoHeight, layout, buffer, preferredSign));
    for (const item of results) {
      if (item.disparityPx !== null && item.depthConfidence >= 0.65) {
        this.polarityVotes = clamp(this.polarityVotes + (item.disparityPx > 0 ? 1 : -1), -12, 12);
      }
    }
    return results;
  }

  reset(): void {
    this.polarityVotes = 0;
    this.activeStereo = false;
  }
}
