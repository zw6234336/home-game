import type { HandObservation, CropRect, Rect, TrackedPlayer, VisionFrame } from '../types.ts';
import { framingFit, toStage, validLandmark } from '../interaction/geometry.ts';
import { faceAnchor, HeadwearTracker } from '../interaction/headwear.ts';
import { scene } from './scene.mjs';
import { drawCostumeFace, drawDemoFace } from './storybook-art.ts';
import type { FaceEffect } from '../game/costumes.ts';
import { drawUnicornPony } from './unicorn.ts';
import { adventureWorlds, type AdventureWorld } from '../art/worlds.ts';
import { worldArt } from '../platform/world-art.ts';
import { stagePixelRatio } from '../platform/television.ts';

export type StageField = { draw(ctx: CanvasRenderingContext2D, fit: Rect): void; clearTrails(): void; faceEffect?(playerId: number): FaceEffect | null };
export type StageOptions = { world?: AdventureWorld; illustration?: string; opacity?: number; background?: string; demoFaces?: boolean; skyStage?: boolean };

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x, y, 42 * scale, 18 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 24 * scale, y - 6 * scale, 24 * scale, 16 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 22 * scale, y - 4 * scale, 26 * scale, 15 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(x, y - 14 * scale, 22 * scale, 16 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const skyStops: readonly [number, number, number, number][] = [
  [0, 201, 222, 250],
  [0.45, 232, 224, 248],
  [0.8, 250, 233, 239],
  [1, 255, 243, 232],
];

function skyRgbAt(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  for (let i = 0; i < skyStops.length - 1; i += 1) {
    const a = skyStops[i];
    const b = skyStops[i + 1];
    if (t <= b[0]) {
      const k = (t - a[0]) / (b[0] - a[0]);
      const r = Math.round(a[1] + (b[1] - a[1]) * k);
      const g = Math.round(a[2] + (b[2] - a[2]) * k);
      const bl = Math.round(a[3] + (b[3] - a[3]) * k);
      return `${r}, ${g}, ${bl}`;
    }
  }
  return '255, 243, 232';
}

function drawSkyBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#c9defa');
  sky.addColorStop(0.45, '#e8e0f8');
  sky.addColorStop(0.8, '#fae9ef');
  sky.addColorStop(1, '#fff3e8');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  const drift = Number.isFinite(now) ? now * 0.008 : 0;
  const span = w + 240;
  drawCloud(ctx, ((w * 0.16 + drift) % span) - 120, h * 0.14, 1.15, 0.72);
  drawCloud(ctx, ((w * 0.56 + drift * 0.7) % span) - 120, h * 0.1, 0.9, 0.65);
  drawCloud(ctx, ((w * 0.84 + drift * 0.9) % span) - 120, h * 0.2, 1.05, 0.68);
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  fit: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private size = '';
  private world: AdventureWorld | undefined;
  private illustration = new Image();
  private illustrationMarkup = '';
  private illustrationOpacity: number;
  private background: string;
  private framing: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private headwear = new HeadwearTracker();
  private faces = new HeadwearTracker(faceAnchor);
  private demoFaces: boolean;
  private televisionPresentation = false;
  private primaryControllerId: number | null = null;
  private skyStage: boolean;
  private skyShift = 0;
  private lastDrawAt: number | null = null;
  constructor(canvas: HTMLCanvasElement, options?: StageOptions) {
    this.world = options?.world;
    this.setIllustration(options?.illustration ?? scene(2, false));
    this.illustrationOpacity = options?.opacity ?? .14;
    this.background = options?.background ?? (options?.world ? adventureWorlds[options.world].ground : '#d9cef2');
    this.demoFaces = options?.demoFaces ?? false;
    this.skyStage = options?.skyStage ?? false;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }
  setIllustration(markup: string) {
    if (markup === this.illustrationMarkup) return;
    this.illustrationMarkup = markup;
    this.illustration.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }
  setPrimaryController(id: number | null) { this.primaryControllerId = id; }
  setTelevisionPresentation(active: boolean) { this.televisionPresentation = active; }
  setFraming(rect: Rect) {
    framingFit(1, 1, 1, 1, rect);
    this.framing = { ...rect };
  }
  draw(video: HTMLVideoElement | null, crop: CropRect, players: TrackedPlayer[], frame: VisionFrame | null, field: StageField | null, now: number, hands: readonly HandObservation[] = []) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = stagePixelRatio(w, h, devicePixelRatio);
    const size = w + '/' + h + '/' + dpr;
    if (this.size !== size) {
      this.canvas.width = Math.floor(w * dpr); this.canvas.height = Math.floor(h * dpr); this.size = size; field?.clearTrails();
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.skyStage) drawSkyBackdrop(ctx, w, h, now);
    else { ctx.fillStyle = this.illustrationOpacity === 1 ? this.background : '#e9e2f3'; ctx.fillRect(0, 0, w, h); }
    const sw = video?.videoWidth ? video.videoWidth * crop.width : 1280;
    const sh = video?.videoHeight ? video.videoHeight * crop.height : 800;
    const baseFit = framingFit(sw, sh, w, h, this.framing);
    if (this.skyStage) {
      const liveCamera = Boolean(video && video.readyState >= 2);
      const wideScale = liveCamera || players.length > 0 ? Math.min(w / sw, (h / sh) * 1.28) : Math.min(w / sw, h / sh);
      const skyWidth = sw * wideScale;
      const skyHeight = sh * wideScale;
      const skyX = (w - skyWidth) / 2;
      let anchorY = 0.56;
      const ys = players.flatMap(player => {
        const points: number[] = [];
        for (const index of [11, 12]) if (validLandmark(player.landmarks[index])) points.push(player.landmarks[index].y);
        for (const wrist of player.wrists) if (wrist && Number.isFinite(wrist.y)) points.push(wrist.y);
        return points;
      });
      if (ys.length > 0) anchorY = Math.max(...ys);
      const desiredBottomY = h * 0.8;
      const minY = Math.min(0, h - skyHeight);
      const maxY = h * 0.34;
      const targetY = liveCamera || players.length > 0 ? Math.max(minY, Math.min(maxY, desiredBottomY - anchorY * skyHeight)) : baseFit.y;
      if (this.lastDrawAt === null || !Number.isFinite(now) || now < this.lastDrawAt || now - this.lastDrawAt > 400) this.skyShift = targetY;
      else this.skyShift += (targetY - this.skyShift) * (1 - Math.exp(-(now - this.lastDrawAt) / 220));
      this.lastDrawAt = Number.isFinite(now) ? now : null;
      this.fit = { x: skyX, y: this.skyShift, width: skyWidth, height: skyHeight };
    } else {
      this.skyShift = 0;
      this.lastDrawAt = null;
      this.fit = baseFit;
    }
    const fit = this.fit;
    if (video && video.readyState >= 2) {
      ctx.save(); ctx.translate(fit.x + fit.width, fit.y); ctx.scale(-1, 1);
      ctx.globalAlpha = field ? 0.32 : 1;
      ctx.drawImage(video, crop.x * video.videoWidth, crop.y * video.videoHeight, sw, sh, 0, 0, fit.width, fit.height); ctx.restore();
      if (this.skyStage) {
        if (fit.y > 2) {
          const topRgb = skyRgbAt(fit.y / h);
          const seam = ctx.createLinearGradient(0, fit.y, 0, fit.y + 54);
          seam.addColorStop(0, `rgba(${topRgb}, 1)`);
          seam.addColorStop(0.55, `rgba(${topRgb}, 0.5)`);
          seam.addColorStop(1, `rgba(${topRgb}, 0)`);
          ctx.fillStyle = seam;
          ctx.fillRect(fit.x - 1, fit.y - 1, fit.width + 2, 56);
        }
        if (fit.x > 4) {
          const sideRgb = skyRgbAt(Math.min(1, (fit.y + Math.max(0, h - fit.y) * 0.5) / h));
          const leftFade = ctx.createLinearGradient(fit.x, 0, fit.x + 36, 0);
          leftFade.addColorStop(0, `rgba(${sideRgb}, 1)`);
          leftFade.addColorStop(1, `rgba(${sideRgb}, 0)`);
          ctx.fillStyle = leftFade;
          ctx.fillRect(fit.x - 1, Math.max(0, fit.y), 38, h - Math.max(0, fit.y));
          const rightFade = ctx.createLinearGradient(fit.x + fit.width, 0, fit.x + fit.width - 36, 0);
          rightFade.addColorStop(0, `rgba(${sideRgb}, 1)`);
          rightFade.addColorStop(1, `rgba(${sideRgb}, 0)`);
          ctx.fillStyle = rightFade;
          ctx.fillRect(fit.x + fit.width - 37, Math.max(0, fit.y), 38, h - Math.max(0, fit.y));
        }
      }
    } else if (!this.skyStage) {
      ctx.fillStyle = this.background; ctx.fillRect(fit.x, fit.y, fit.width, fit.height);
      if (!(field && this.world && worldArt.get(this.world)) && this.illustration.complete && this.illustration.naturalWidth) { ctx.globalAlpha = this.illustrationOpacity; ctx.drawImage(this.illustration, fit.x, fit.y, fit.width, fit.height); ctx.globalAlpha = 1; }
      ctx.strokeStyle = '#c9bcdf'; ctx.lineWidth = 1;
      if (this.illustrationOpacity < 1) for (let x = 24; x < w; x += 48) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 30, h - 70); ctx.stroke(); }
    }
    const worldImage = !video && field && this.world ? worldArt.get(this.world) : null;
    if (worldImage) {
      const scale = Math.max(w / worldImage.naturalWidth, h / worldImage.naturalHeight);
      const width = worldImage.naturalWidth * scale;
      const height = worldImage.naturalHeight * scale;
      ctx.save();
      ctx.globalAlpha = this.skyStage ? 0.1 : 0.14;
      ctx.drawImage(worldImage, (w - width) / 2, (h - height) / 2, width, height);
      ctx.restore();
    }
    if (frame && now - frame.capturedAt <= 150) {
      this.headwear.prune(new Set(players.map(player => player.id)));
      this.faces.prune(new Set(players.map(player => player.id)));
      const links = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24]];
      players.forEach((player, index) => {
        ctx.strokeStyle = index ? '#e88862' : '#5ba991'; ctx.lineWidth = 3;
        for (const [a, b] of links) if (validLandmark(player.landmarks[a]) && validLandmark(player.landmarks[b])) {
          const p = toStage(player.landmarks[a], fit); const q = toStage(player.landmarks[b], fit);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
        const effect = field?.faceEffect?.(player.id);
        const face = this.faces.update(player, fit, now);
        if (effect && face) {
          drawCostumeFace(ctx, face, effect);
        }
        const crown = this.headwear.update(player, fit, now);
        if (crown && !effect) {
          const headroom = crown.y < crown.size * 0.85 ? Math.max(0.55, crown.y / (crown.size * 0.85)) : 1;
          drawUnicornPony(ctx, { ...crown, y: Math.max(crown.size * headroom * 0.82, crown.y), size: crown.size * headroom }, index, now);
        }
        for (const hand of player.wrists) if (hand) {
          const p = toStage(hand, fit); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 7); ctx.fill(); ctx.stroke();
        }
      });
      if (now - frame.handsCapturedAt <= 150) for (const hand of hands) {
        ctx.fillStyle = '#f9da78';
        for (const landmark of hand.landmarks) if (validLandmark(landmark)) { const p = toStage(landmark, fit); ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, 7); ctx.fill(); }
      }
    } else {
      this.headwear.reset();
      this.faces.reset();
    }
    field?.draw(ctx, fit);
    const controller = frame && now - frame.capturedAt <= 150 ? players.find(player => player.id === this.primaryControllerId) : null;
    if (controller && validLandmark(controller.landmarks[11]) && validLandmark(controller.landmarks[12])) {
      const anchor = toStage({ x: (controller.landmarks[11].x + controller.landmarks[12].x) / 2, y: (controller.landmarks[11].y + controller.landmarks[12].y) / 2 }, fit);
      const x = Math.max(52, Math.min(w - 52, anchor.x));
      const y = Math.max(18, Math.min(h - 34, anchor.y + 28));
      ctx.save(); ctx.fillStyle = '#395f53'; ctx.beginPath(); ctx.roundRect(x - 49, y, 98, 28, 14); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = '600 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('主控伙伴', x, y + 14); ctx.restore();
    }
    if (this.demoFaces) drawDemoFace(ctx, w - 92, this.televisionPresentation ? 230 : 100, 48, field?.faceEffect?.(1) ?? null);
  }
}
