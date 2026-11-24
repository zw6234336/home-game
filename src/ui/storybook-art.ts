import type { GameArt } from '../art/catalog.ts';
import { gameArt } from '../platform/game-art.ts';
import type { HeadwearPose } from '../interaction/headwear.ts';
import type { FaceEffect } from '../game/costumes.ts';
import { faceNames } from '../game/costumes.ts';
import { drawSootFace } from './soot-face.ts';
import { drawPinkBunnyFace, drawPrincessFace } from './gate-costumes.ts';

export function drawTreasure(ctx: CanvasRenderingContext2D, name: GameArt, x: number, y: number, radius: number, angle: number, points: number): boolean {
  const image = gameArt.get(name);
  if (!image) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(image, -radius * 1.22, -radius * 1.22, radius * 2.44, radius * 2.44);
  ctx.restore();
  if (name !== 'bomb') {
    ctx.save();
    ctx.font = '800 ' + Math.round(Math.max(14, radius * 0.45)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.strokeText('+' + points, x, y + radius);
    ctx.fillStyle = points === 30 ? '#80520b' : '#593a71';
    ctx.fillText('+' + points, x, y + radius);
    ctx.restore();
  }
  return true;
}

export function drawCostumeFace(ctx: CanvasRenderingContext2D, face: HeadwearPose, effect: FaceEffect): void {
  if (effect.kind === 'princess') {
    drawPrincessFace(ctx, face, effect.alpha, effect.elapsedMs, false);
    return;
  }
  if (effect.kind === 'pink-bunny') {
    drawPinkBunnyFace(ctx, face, effect.alpha, effect.elapsedMs);
    return;
  }
  const image = effect.kind === 'soot' ? null : gameArt.get(effect.kind);
  if (!image) {
    drawSootFace(ctx, face, effect.alpha, effect.elapsedMs);
    return;
  }
  const size = face.size * (effect.kind === 'donkey' ? 2.4 : 1.8);
  const anchorY = effect.kind === 'donkey' ? 0.64 : 0.53;
  ctx.save();
  ctx.translate(face.x, face.y);
  ctx.rotate(face.angle);
  ctx.globalAlpha = effect.alpha;
  ctx.drawImage(image, -size * 0.5, -size * anchorY, size, size);
  ctx.restore();
}

export function drawDemoFace(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, effect: FaceEffect | null): void {
  ctx.save();
  ctx.fillStyle = '#fff8f3';
  ctx.strokeStyle = '#9e89c1';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.64, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (effect?.kind === 'princess') drawPrincessFace(ctx, { x, y, size, angle: 0 }, effect.alpha, effect.elapsedMs, true);
  else if (effect) drawCostumeFace(ctx, { x, y, size, angle: 0 }, effect);
  else {
    ctx.fillStyle = '#46345b';
    for (const dx of [-0.22, 0.22]) {
      ctx.beginPath();
      ctx.arc(x + size * dx, y - size * 0.1, size * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y + size * 0.07, size * 0.24, 0.1, Math.PI - 0.1);
    ctx.stroke();
  }
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#46345b';
  ctx.fillText(effect ? faceNames[effect.kind] + ' · 演示' : '变身演示', x, y + size * 0.86);
  ctx.restore();
}
