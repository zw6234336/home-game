import type { HeadwearPose } from '../interaction/headwear.ts';

type Palette = {
  body: string;
  belly: string;
  band: string;
  manePrimary: string;
  maneSecondary: string;
  maneAccent: string;
  cheek: string;
  hornBase: string;
  hornStripe: string;
  hoof: string;
  ink: string;
};

const palettes: readonly Palette[] = [
  {
    body: '#fffaf4',
    belly: '#f5eefc',
    band: '#b7a4ed',
    manePrimary: '#69bda5',
    maneSecondary: '#b7a4ed',
    maneAccent: '#f5dc81',
    cheek: '#f7a593',
    hornBase: '#f7d972',
    hornStripe: '#e29f3b',
    hoof: '#a58fd8',
    ink: '#302744',
  },
  {
    body: '#fff8f4',
    belly: '#fdece4',
    band: '#f49a7d',
    manePrimary: '#f47d5b',
    maneSecondary: '#f5dc81',
    maneAccent: '#b7a4ed',
    cheek: '#f48d7e',
    hornBase: '#fae184',
    hornStripe: '#e49844',
    hoof: '#e07b5f',
    ink: '#302744',
  },
];

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, color: string): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
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

export function drawUnicornPony(ctx: CanvasRenderingContext2D, pose: HeadwearPose, variant: number, now: number): void {
  const palette = palettes[Math.abs(variant) % palettes.length];
  const s = pose.size / 120;
  const bob = Number.isFinite(now) ? Math.sin(now * 0.0042 + variant * 1.7) * 2.2 : 0;
  const twinkle = Number.isFinite(now) ? 0.72 + 0.28 * Math.sin(now * 0.0075 + variant * 2.3) : 1;

  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.arc(0, 50, 56, Math.PI * 1.25, Math.PI * 1.75);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.strokeStyle = palette.band;
  ctx.lineWidth = 5.5;
  ctx.stroke();

  ctx.translate(-4, bob);

  ctx.beginPath();
  ctx.moveTo(-24, -16);
  ctx.bezierCurveTo(-50, -22, -56, -4, -40, 2);
  ctx.bezierCurveTo(-48, 8, -38, 16, -26, 7);
  ctx.closePath();
  ctx.fillStyle = palette.manePrimary;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(-6, -15, 28, 18, -0.05, 0, Math.PI * 2);
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(-4, -11, 17, 8.5, -0.04, 0, Math.PI * 2);
  ctx.fillStyle = palette.belly;
  ctx.fill();

  for (const [hx, hy] of [[-20, -2], [-2, 0], [16, -2]]) {
    ctx.beginPath();
    ctx.ellipse(hx, hy, 7.2, 5.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.body;
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hx, hy + 2, 5, 2.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = palette.hoof;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(4, -36);
  ctx.bezierCurveTo(-8, -44, -16, -30, -6, -21);
  ctx.bezierCurveTo(-16, -17, -12, -4, 0, -10);
  ctx.closePath();
  ctx.fillStyle = palette.maneSecondary;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(10, -52);
  ctx.lineTo(5, -68);
  ctx.lineTo(18, -58);
  ctx.closePath();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(18, -38, 22, 19, -0.06, 0, Math.PI * 2);
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(20, -54);
  ctx.lineTo(26, -71);
  ctx.lineTo(32, -53);
  ctx.closePath();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(23, -55);
  ctx.lineTo(26, -65);
  ctx.lineTo(29, -55);
  ctx.closePath();
  ctx.fillStyle = palette.cheek;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(22, -52);
  ctx.lineTo(40, -84);
  ctx.lineTo(32, -48);
  ctx.closePath();
  ctx.fillStyle = palette.hornBase;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(25, -59);
  ctx.lineTo(34, -56);
  ctx.moveTo(29, -67);
  ctx.lineTo(36, -65);
  ctx.moveTo(33, -74);
  ctx.lineTo(38, -73);
  ctx.strokeStyle = palette.hornStripe;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(9, -49, 9, 0, Math.PI * 2);
  ctx.fillStyle = palette.manePrimary;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(17, -53, 7, 0, Math.PI * 2);
  ctx.fillStyle = palette.maneAccent;
  ctx.fill();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(26, -39, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = palette.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(27.2, -40.2, 1.3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(21, -32, 4.6, 2.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = palette.cheek;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(34, -32, 3.8, 0.2, Math.PI * 0.85);
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2;
  ctx.stroke();

  drawStar(ctx, 43, -87, 7.5 * twinkle, 2.8 * twinkle, '#fff2a6');
  drawStar(ctx, -32, -44, 5 * twinkle, 2 * twinkle, palette.maneAccent);

  ctx.restore();
}
