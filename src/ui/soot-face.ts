import type { HeadwearPose } from '../interaction/headwear.ts';

export function drawSootFace(ctx: CanvasRenderingContext2D, face: HeadwearPose, intensity: number, now: number): void {
  if (!Number.isFinite(intensity) || intensity <= 0) return;
  const alpha = Math.max(0, Math.min(1, intensity));
  const r = face.size * 0.62;
  const drift = Number.isFinite(now) ? now * 0.0025 : 0;

  ctx.save();
  ctx.translate(face.x, face.y);
  ctx.rotate(face.angle);

  ctx.globalAlpha = 0.45 * alpha;
  ctx.fillStyle = '#18141f';
  for (const [ox, oy, rx, ry] of [
    [0, 0, r * 1.12, r * 1.18],
    [-r * 0.55, -r * 0.25, r * 0.56, r * 0.52],
    [r * 0.55, -r * 0.22, r * 0.58, r * 0.5],
    [-r * 0.42, r * 0.42, r * 0.58, r * 0.5],
    [r * 0.44, r * 0.4, r * 0.56, r * 0.5],
    [0, -r * 0.58, r * 0.68, r * 0.48],
  ]) {
    ctx.beginPath();
    ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.86 * alpha;
  ctx.fillStyle = '#14111a';
  ctx.beginPath();
  ctx.ellipse(0, r * 0.04, r * 0.94, r * 1.02, 0, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 10; i++) {
    const theta = (i * Math.PI * 2) / 10 + 0.2;
    const dist = r * (0.72 + (i % 3) * 0.12);
    ctx.beginPath();
    ctx.arc(Math.cos(theta) * dist, Math.sin(theta) * dist, r * (0.24 + (i % 2) * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.92 * alpha;
  ctx.fillStyle = '#0c0910';
  for (const [sx, sy, sr] of [
    [-r * 0.34, r * 0.14, r * 0.28],
    [r * 0.32, r * 0.18, r * 0.26],
    [0, r * 0.36, r * 0.32],
    [0, -r * 0.34, r * 0.3],
  ]) {
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.94 * alpha;
  for (const ex of [-r * 0.31, r * 0.31]) {
    ctx.beginPath();
    ctx.ellipse(ex, -r * 0.12, r * 0.17, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#302744';
    ctx.lineWidth = Math.max(1.8, r * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, -r * 0.12, r * 0.065, 0, Math.PI * 2);
    ctx.fillStyle = '#14111a';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(0, r * 0.3, r * 0.16, Math.PI * 1.15, Math.PI * 1.85);
  ctx.strokeStyle = '#e8dfd6';
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.lineCap = 'round';
  ctx.stroke();

  for (let i = 0; i < 4; i++) {
    const cycle = (drift + i * 0.78) % 2.4;
    const progress = cycle / 2.4;
    const puffX = (i - 1.5) * r * 0.42 + Math.sin(drift * 2 + i * 1.9) * r * 0.14;
    const puffY = -r * (0.95 + progress * 1.15);
    const puffR = r * (0.16 + progress * 0.18);
    ctx.globalAlpha = (1 - progress) * 0.58 * alpha;
    ctx.fillStyle = i % 2 === 0 ? '#6d6678' : '#a49dae';
    ctx.beginPath();
    ctx.arc(puffX, puffY, puffR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
