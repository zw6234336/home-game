import type { HeadwearPose } from '../interaction/headwear.ts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawSparkStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, color: string): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const theta = (i * Math.PI) / 4;
    const px = cx + Math.cos(theta) * r;
    const py = cy + Math.sin(theta) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawGemDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, fill: string, stroke: string): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - rx * 0.28, cy - ry * 0.28, Math.max(1.5, rx * 0.26), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

export function drawPrincessFace(
  ctx: CanvasRenderingContext2D,
  face: HeadwearPose,
  intensity: number,
  elapsedMs: number,
  withAvatarFace = false,
): void {
  if (!Number.isFinite(intensity) || intensity <= 0) return;
  const alpha = clamp(intensity, 0, 1);
  const t = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const s = face.size / 100;
  const floatY = Math.sin(t * 0.0045) * 1.8;
  const twinkle = 0.72 + 0.28 * Math.sin(t * 0.008);
  const goldInk = '#7a4f1d';

  ctx.save();
  ctx.translate(face.x, face.y);
  ctx.rotate(face.angle);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.globalAlpha = 0.34 * alpha;
  ctx.fillStyle = '#ffbfd9';
  ctx.beginPath();
  ctx.moveTo(-36, -64 + floatY);
  ctx.bezierCurveTo(-82, -26, -86, 36, -62, 66);
  ctx.lineTo(62, 66);
  ctx.bezierCurveTo(86, 36, 82, -26, 36, -64 + floatY);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = alpha;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(-26, -58);
    ctx.bezierCurveTo(-66, -48, -74, 2, -62, 42);
    ctx.bezierCurveTo(-68, 56, -54, 68, -42, 60);
    ctx.bezierCurveTo(-50, 34, -46, -18, -28, -36);
    ctx.closePath();
    ctx.fillStyle = '#f5ca5a';
    ctx.fill();
    ctx.strokeStyle = goldInk;
    ctx.lineWidth = 2.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-42, -32);
    ctx.bezierCurveTo(-56, -8, -58, 22, -48, 48);
    ctx.strokeStyle = '#fff0b2';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
  }

  if (withAvatarFace) {
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, Math.PI * 2);
    ctx.fillStyle = '#fff5ec';
    ctx.fill();
    ctx.strokeStyle = '#6c424e';
    ctx.lineWidth = 2.6;
    ctx.stroke();

    for (const side of [-1, 1]) {
      const ex = side * 16;
      const ey = -4;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 4.8, 5.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#3b2436';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - 1.5, ey - 2, 1.9, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ex + side * 3.8, ey - 2.5);
      ctx.quadraticCurveTo(ex + side * 6.5, ey - 3.5, ex + side * 8, ey - 6);
      ctx.strokeStyle = '#3b2436';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex - side * 5, ey - 10.5);
      ctx.quadraticCurveTo(ex, ey - 14.5, ex + side * 6.5, ey - 10.5);
      ctx.strokeStyle = goldInk;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, 12, 11, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.strokeStyle = '#c4536f';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.globalAlpha = 0.42 * alpha;
  ctx.fillStyle = '#ff8bb0';
  for (const bx of [-27, 27]) {
    ctx.beginPath();
    ctx.ellipse(bx, 11, 9.5, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = alpha;
  for (const side of [-1, 1]) {
    const px = side * 47;
    ctx.beginPath();
    ctx.arc(px, 21, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff9f2';
    ctx.fill();
    ctx.strokeStyle = goldInk;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, 13, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = '#f8d05a';
    ctx.fill();
  }

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(-42, -32);
    ctx.bezierCurveTo(-30, -56, -8, -60, 0, -44);
    ctx.bezierCurveTo(-18, -36, -30, -24, -42, -16);
    ctx.closePath();
    ctx.fillStyle = '#f8d56c';
    ctx.fill();
    ctx.strokeStyle = goldInk;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(0, floatY);
  ctx.beginPath();
  ctx.moveTo(-40, -52);
  ctx.lineTo(-34, -84);
  ctx.lineTo(-18, -68);
  ctx.lineTo(0, -108);
  ctx.lineTo(18, -68);
  ctx.lineTo(34, -84);
  ctx.lineTo(40, -52);
  ctx.quadraticCurveTo(0, -45, -40, -52);
  ctx.closePath();
  ctx.fillStyle = '#f9cf4c';
  ctx.fill();
  ctx.strokeStyle = goldInk;
  ctx.lineWidth = 2.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-30, -56);
  ctx.lineTo(0, -94);
  ctx.lineTo(30, -56);
  ctx.strokeStyle = '#fff3b8';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  drawGemDiamond(ctx, 0, -76, 8.5, 11.5, '#ff5d97', goldInk);
  drawGemDiamond(ctx, -25, -67, 5.2, 6.8, '#6ec5f4', goldInk);
  drawGemDiamond(ctx, 25, -67, 5.2, 6.8, '#6ec5f4', goldInk);

  for (const [px, py, pr] of [
    [-34, -85, 3.6],
    [0, -109, 4.4],
    [34, -85, 3.6],
  ]) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = '#fffaf0';
    ctx.fill();
    ctx.strokeStyle = goldInk;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  drawSparkStar(ctx, -48, -96, 8 * twinkle, 3 * twinkle, '#ffe98a');
  drawSparkStar(ctx, 48, -96, 8 * twinkle, 3 * twinkle, '#ffe98a');
  drawSparkStar(ctx, 0, -118, 6.5 * twinkle, 2.5 * twinkle, '#fff7c4');
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(-36, 48);
  ctx.quadraticCurveTo(-18, 66, 0, 56);
  ctx.quadraticCurveTo(18, 66, 36, 48);
  ctx.quadraticCurveTo(16, 72, 0, 65);
  ctx.quadraticCurveTo(-16, 72, -36, 48);
  ctx.closePath();
  ctx.fillStyle = '#ffa8cb';
  ctx.fill();
  ctx.strokeStyle = '#8b3e60';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  drawGemDiamond(ctx, 0, 60, 5.5, 6.5, '#ffd452', goldInk);
  ctx.restore();
}

function drawFluffyBunnyEar(ctx: CanvasRenderingContext2D, side: number, angle: number): void {
  const ink = '#87385a';
  ctx.save();
  ctx.translate(side * 25, -52);
  ctx.rotate(angle);

  const puffs: readonly [number, number, number][] = [
    [-12, -22, 14],
    [12, -22, 14],
    [-15, -48, 15],
    [15, -48, 15],
    [-13, -74, 14],
    [13, -74, 14],
    [0, -92, 16],
    [0, -54, 18],
  ];
  ctx.fillStyle = '#f69cc0';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.2;
  for (const [px, py, pr] of puffs) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const [px, py, pr] of puffs) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(0, -50, 9.5, 36, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffdfec';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, -52, 5.5, 24, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff0f7';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(side * 3, -2, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#fbb9d3';
  ctx.fill();
  ctx.restore();
}

export function drawPinkBunnyFace(
  ctx: CanvasRenderingContext2D,
  face: HeadwearPose,
  intensity: number,
  elapsedMs: number,
): void {
  if (!Number.isFinite(intensity) || intensity <= 0) return;
  const alpha = clamp(intensity, 0, 1);
  const t = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  const s = face.size / 100;
  const sway = Math.sin(t * 0.0055) * 0.07;
  const noseTwitch = Math.sin(t * 0.012) * 1.1;
  const ink = '#87385a';

  ctx.save();
  ctx.translate(face.x, face.y);
  ctx.rotate(face.angle);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawFluffyBunnyEar(ctx, -1, -0.2 + sway);
  drawFluffyBunnyEar(ctx, 1, 0.22 - sway);

  const puffCount = 16;
  const haloPuffs: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < puffCount; i += 1) {
    const theta = (i * Math.PI * 2) / puffCount;
    haloPuffs.push({
      x: Math.cos(theta) * 53,
      y: Math.sin(theta) * 48 + 3,
      r: 14 + (i % 2) * 2.5,
    });
  }

  ctx.strokeStyle = ink;
  ctx.lineWidth = 3.2;
  for (const puff of haloPuffs) {
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#f597bc';
  for (const puff of haloPuffs) {
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(0, 3, 52, 47, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fbbbd5';
  ctx.fill();

  for (const [fx, fy, fr] of [
    [0, -45, 13],
    [-12, -41, 10],
    [12, -41, 10],
  ]) {
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcce0';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-7, -45);
  ctx.quadraticCurveTo(0, -54, 7, -45);
  ctx.strokeStyle = '#df6f9d';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(-12, 19, 17, 13, 0, 0, Math.PI * 2);
  ctx.ellipse(12, 19, 17, 13, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff0f6';
  ctx.fill();

  ctx.globalAlpha = 0.48 * alpha;
  ctx.fillStyle = '#ff72a6';
  for (const bx of [-36, 36]) {
    ctx.beginPath();
    ctx.ellipse(bx, 11, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = alpha;
  for (const side of [-1, 1]) {
    const ex = side * 21;
    const ey = -8;
    ctx.beginPath();
    ctx.ellipse(ex, ey, 7.2, 9.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#361e32';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - 2.1, ey - 3.2, 2.7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + 2.2, ey + 2.5, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(-7, 10 + noseTwitch);
  ctx.quadraticCurveTo(0, 7 + noseTwitch, 7, 10 + noseTwitch);
  ctx.lineTo(0, 18 + noseTwitch);
  ctx.closePath();
  ctx.fillStyle = '#ea4b85';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(-5, 24, 4.5, 5);
  ctx.rect(0.5, 24, 4.5, 5);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, 18 + noseTwitch);
  ctx.lineTo(0, 23);
  ctx.moveTo(0, 23);
  ctx.quadraticCurveTo(-7, 29, -14, 22);
  ctx.moveTo(0, 23);
  ctx.quadraticCurveTo(7, 29, 14, 22);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4;
  ctx.stroke();

  for (const side of [-1, 1]) {
    for (const [dy0, dy1] of [
      [-4, -10],
      [2, 2],
      [8, 12],
    ]) {
      ctx.beginPath();
      ctx.moveTo(side * 34, 15 + dy0);
      ctx.quadraticCurveTo(side * 54, 13 + dy1 * 0.5, side * 72, 15 + dy1);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.1;
      ctx.stroke();
    }
  }

  for (const [cx, cy, cr] of [
    [-22, 56, 9],
    [-8, 59, 9.5],
    [8, 59, 9.5],
    [22, 56, 9],
  ]) {
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc9df';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const puffAlpha = 0.65 + 0.35 * Math.sin(t * 0.007);
  ctx.globalAlpha = puffAlpha * alpha;
  drawSparkStar(ctx, -56, -124, 6.5, 2.4, '#ffc2dc');
  drawSparkStar(ctx, 58, -118, 6.5, 2.4, '#ffc2dc');
  ctx.restore();
}
