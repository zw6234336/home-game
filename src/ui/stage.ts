import type { CropRect, Rect, TrackedPlayer, VisionFrame } from '../types.ts';
import { framingFit, toStage, validLandmark } from '../interaction/geometry.ts';
import { faceAnchor, HeadwearTracker } from '../interaction/headwear.ts';
import { scene } from './scene.mjs';
import { drawCostumeFace, drawDemoFace } from './storybook-art.ts';
import type { FaceEffect } from '../game/costumes.ts';
import { drawUnicornPony } from './unicorn.ts';

export type StageField = { draw(ctx: CanvasRenderingContext2D, fit: Rect): void; clearTrails(): void; faceEffect?(playerId: number): FaceEffect | null };

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  fit: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private size = '';
  private illustration = new Image();
  private illustrationMarkup = '';
  private illustrationOpacity: number;
  private background: string;
  private framing: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private headwear = new HeadwearTracker();
  private faces = new HeadwearTracker(faceAnchor);
  private demoFaces: boolean;
  constructor(canvas: HTMLCanvasElement, options?: { illustration?: string; opacity?: number; background?: string; demoFaces?: boolean }) {
    this.setIllustration(options?.illustration ?? scene(2, false));
    this.illustrationOpacity = options?.opacity ?? .14;
    this.background = options?.background ?? '#d9cef2';
    this.demoFaces = options?.demoFaces ?? false;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }
  setIllustration(markup: string) {
    if (markup === this.illustrationMarkup) return;
    this.illustrationMarkup = markup;
    this.illustration.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  }
  setFraming(rect: Rect) {
    framingFit(1, 1, 1, 1, rect);
    this.framing = { ...rect };
  }
  draw(video: HTMLVideoElement | null, crop: CropRect, players: TrackedPlayer[], frame: VisionFrame | null, field: StageField | null, now: number) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio, 1.5);
    const size = w + '/' + h + '/' + dpr;
    if (this.size !== size) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this.size = size; field?.clearTrails();
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.illustrationOpacity === 1 ? this.background : '#e9e2f3'; ctx.fillRect(0, 0, w, h);
    const sw = video?.videoWidth ? video.videoWidth * crop.width : 1280;
    const sh = video?.videoHeight ? video.videoHeight * crop.height : 800;
    this.fit = framingFit(sw, sh, w, h, this.framing);
    const fit = this.fit;
    if (video && video.readyState >= 2) {
      ctx.save(); ctx.translate(fit.x + fit.width, fit.y); ctx.scale(-1, 1);
      ctx.globalAlpha = field ? 0.32 : 1;
      ctx.drawImage(video, crop.x * video.videoWidth, crop.y * video.videoHeight, sw, sh, 0, 0, fit.width, fit.height); ctx.restore();
    } else {
      ctx.fillStyle = this.background; ctx.fillRect(fit.x, fit.y, fit.width, fit.height);
      if (this.illustration.complete && this.illustration.naturalWidth) { ctx.globalAlpha = this.illustrationOpacity; ctx.drawImage(this.illustration, fit.x, fit.y, fit.width, fit.height); ctx.globalAlpha = 1; }
      ctx.strokeStyle = '#c9bcdf'; ctx.lineWidth = 1;
      if (this.illustrationOpacity < 1) for (let x = 24; x < w; x += 48) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 30, h - 70); ctx.stroke(); }
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
      if (now - frame.handsCapturedAt <= 150) for (const hand of frame.hands) {
        ctx.fillStyle = '#f9da78';
        for (const landmark of hand.landmarks) if (validLandmark(landmark)) { const p = toStage(landmark, fit); ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, 7); ctx.fill(); }
      }
    } else {
      this.headwear.reset();
      this.faces.reset();
    }
    field?.draw(ctx, fit);
    if (this.demoFaces) drawDemoFace(ctx, w - 92, 100, 48, field?.faceEffect?.(1) ?? null);
  }
}
