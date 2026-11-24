import type { Point, ReachZone, Rect } from '../types.ts';
import { intersectsSweep, toStage } from '../interaction/geometry.ts';
import { treasureForTier, type TreasureArt } from '../art/catalog.ts';
import { FaceEffects, faceNames, type FaceEffect } from './costumes.ts';
import { drawTreasure } from '../ui/storybook-art.ts';

export type HeartKind = 'pink' | 'big' | 'gold';
export type FallingKind = HeartKind | 'bomb';
export type HeartCatchEvent = { id: string; playerId: number; points: number; golden: boolean; kind: HeartKind };
export type BombHitEvent = { id: string; playerId: number; points: number };
export type CatchPair = { playerId: number; left: Point | null; right: Point | null; shoulderWidth: number };

type FallingItem = {
  id: string;
  playerId: number;
  x: number;
  baseX: number;
  y: number;
  vy: number;
  swayAmp: number;
  swaySpeed: number;
  phase: number;
  radius: number;
  kind: FallingKind;
  art: TreasureArt | 'bomb' | null;
  points: number;
  color: string;
  age: number;
};

type BasketSegment = {
  playerId: number;
  center: Point;
  start: Point;
  end: Point;
  width: number;
  angle: number;
};

type Burst = { x: number; y: number; vx: number; vy: number; age: number; size: number; color: string; smoke: boolean };
type PopText = { x: number; y: number; text: string; color: string; age: number };

const pinkPalette = ['#f47d5b', '#f2849e', '#eb6f87'];
const bigPalette = ['#69bda5', '#b7a4ed'];
const goldColor = '#f5c84c';
const bombColor = '#252130';
const laneOrder = [0, 3, 1, 4, 2];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function validPoint(point: Point | null | undefined): point is Point {
  return point !== null && point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function drawHeartShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, fill: string, stroke: string, shimmer: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.85);
  ctx.bezierCurveTo(-r * 1.18, r * 0.12, -r * 1.1, -r * 0.88, -r * 0.48, -r * 0.88);
  ctx.bezierCurveTo(-r * 0.16, -r * 0.88, 0, -r * 0.56, 0, -r * 0.36);
  ctx.bezierCurveTo(0, -r * 0.56, r * 0.16, -r * 0.88, r * 0.48, -r * 0.88);
  ctx.bezierCurveTo(r * 1.1, -r * 0.88, r * 1.18, r * 0.12, 0, r * 0.85);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-r * 0.38, -r * 0.38, r * 0.2, r * 0.11, -0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffffcc';
  ctx.fill();
  if (shimmer) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const len = i % 2 === 0 ? r * 0.38 : r * 0.14;
      const theta = (i * Math.PI) / 4;
      const px = r * 0.52 + Math.cos(theta) * len;
      const py = -r * 0.62 + Math.sin(theta) * len;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff5b8';
    ctx.fill();
  }
  ctx.restore();
}

function drawBombShape(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tilt: number, age: number): void {
  const spark = 0.75 + 0.35 * Math.sin(age * 0.022);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  ctx.beginPath();
  ctx.moveTo(0, -r * 0.86);
  ctx.quadraticCurveTo(r * 0.35, -r * 1.38, r * 0.72, -r * 1.24);
  ctx.strokeStyle = '#6c5a4b';
  ctx.lineWidth = Math.max(2.5, r * 0.11);
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(-r * 0.28, -r * 0.96, r * 0.56, r * 0.26);
  ctx.fillStyle = '#5b5368';
  ctx.fill();
  ctx.strokeStyle = '#191421';
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, r * 0.05, r * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = bombColor;
  ctx.fill();
  ctx.strokeStyle = '#120e18';
  ctx.lineWidth = Math.max(2.4, r * 0.1);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(-r * 0.32, -r * 0.24, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff55';
  ctx.fill();

  ctx.fillStyle = '#f47d5b';
  ctx.font = '800 ' + Math.round(r * 0.95) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, r * 0.12);

  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const len = (i % 2 === 0 ? r * 0.42 : r * 0.16) * spark;
    const theta = (i * Math.PI) / 4 + age * 0.008;
    const px = r * 0.74 + Math.cos(theta) * len;
    const py = -r * 1.24 + Math.sin(theta) * len;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ff9b42';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(r * 0.74, -r * 1.24, r * 0.14 * spark, 0, Math.PI * 2);
  ctx.fillStyle = '#fff5b8';
  ctx.fill();

  ctx.restore();
}

function basketSegment(pair: CatchPair, fit: Rect): BasketSegment | null {
  const left = pair.left ? toStage(pair.left, fit) : null;
  const right = pair.right ? toStage(pair.right, fit) : null;
  if (!left && !right) return null;
  const center = left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : (left ?? right)!;
  let angle = 0;
  if (left && right) {
    const a = left.x <= right.x ? left : right;
    const b = left.x <= right.x ? right : left;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx > 8) angle = clamp(Math.atan2(dy, dx), -0.35, 0.35);
  }
  const normalizedWidth = Number.isFinite(pair.shoulderWidth) && pair.shoulderWidth > 0 ? pair.shoulderWidth : 0.18;
  const width = clamp(normalizedWidth * fit.width * 1.05, 68, Math.max(96, fit.width * 0.34));
  const half = width / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    playerId: pair.playerId,
    center,
    start: { x: center.x - half * cos, y: center.y - half * sin },
    end: { x: center.x + half * cos, y: center.y + half * sin },
    width,
    angle,
  };
}

export class HeartCatchField {
  private items: FallingItem[] = [];
  private bursts: Burst[] = [];
  private popTexts: PopText[] = [];
  private catchers: CatchPair[] = [];
  private costumes = new FaceEffects();
  private pulseAge = 1000;
  private zones: ReachZone[] = [];
  private serial = 0;
  private spawnAge = 800;
  private remainingMs = 60000;
  private gentle: boolean;
  private onCatch: (event: HeartCatchEvent) => boolean;
  private onBomb: (event: BombHitEvent) => boolean;
  private onMiss: () => void;

  constructor(
    zones: ReachZone[],
    gentle: boolean,
    onCatch: (event: HeartCatchEvent) => boolean,
    onMiss: () => void,
    onBomb: (event: BombHitEvent) => boolean = () => true,
  ) {
    this.gentle = gentle;
    this.onCatch = onCatch;
    this.onMiss = onMiss;
    this.onBomb = onBomb;
    this.setZones(zones);
  }

  clearTrails(): void {
    this.catchers = [];
  }

  setRemainingMs(ms: number): void {
    if (Number.isFinite(ms)) this.remainingMs = Math.max(0, ms);
  }

  faceEffect(playerId: number): FaceEffect | null {
    return this.costumes.get(playerId);
  }

  waveLabel(): string {
    if (this.remainingMs <= 15000) return '宝物大丰收！皇冠 +30，躲开变身炸弹';
    if (this.remainingMs <= 40000) return '爱心和宝物一起落下，稳稳接住！';
    return '接水晶鞋、包包和公主裙，小心炸弹让你变身！';
  }

  setZones(zones: ReachZone[]): void {
    this.zones = zones
      .filter(zone => [zone.playerId, zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) && zone.x >= 0 && zone.y >= 0 && zone.width > 0 && zone.height > 0 && zone.x + zone.width <= 1 && zone.y + zone.height <= 1)
      .map(zone => ({ ...zone }));
    this.costumes.prune(new Set(this.zones.map(zone => zone.playerId)));
  }

  update(delta: number, fit: Rect): void {
    if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(fit.height) || fit.height <= 0 || !Number.isFinite(fit.width) || fit.width <= 0) return;
    this.costumes.advance(delta);
    const dt = delta / 1000;
    this.spawnAge += delta;
    this.pulseAge = Math.min(1000, this.pulseAge + delta);
    const fever = this.remainingMs <= 15000;
    const mid = this.remainingMs <= 40000 && !fever;
    const interval = fever ? (this.gentle ? 430 : 320) : mid ? (this.gentle ? 660 : 490) : (this.gentle ? 860 : 650);
    const cap = fever ? (this.gentle ? 11 : 13) : mid ? (this.gentle ? 8 : 10) : (this.gentle ? 6 : 8);

    if (this.spawnAge >= interval && this.items.length < cap && this.zones.length > 0) {
      this.spawnAge = 0;
      const zone = this.zones[this.serial % this.zones.length];
      const roll = Math.random();
      const bombThreshold = fever ? 0.26 : mid ? 0.23 : 0.18;
      const goldThreshold = bombThreshold + (fever ? 0.28 : mid ? 0.18 : 0.12);
      const bigThreshold = goldThreshold + (fever ? 0.22 : 0.2);
      const kind: FallingKind = roll < bombThreshold ? 'bomb' : roll < goldThreshold ? 'gold' : roll < bigThreshold ? 'big' : 'pink';
      const points = kind === 'bomb' ? 20 : kind === 'gold' ? 30 : kind === 'big' ? 20 : 10;
      const color = kind === 'bomb' ? bombColor : kind === 'gold' ? goldColor : kind === 'big' ? bigPalette[this.serial % bigPalette.length] : pinkPalette[this.serial % pinkPalette.length];
      const baseRadius = kind === 'bomb' ? (this.gentle ? 0.056 : 0.048) : kind === 'big' ? (this.gentle ? 0.066 : 0.054) : kind === 'gold' ? (this.gentle ? 0.058 : 0.048) : (this.gentle ? 0.056 : 0.045);
      const pxRadius = clamp(fit.height * baseRadius, 22, 56);

      const viewLeft = clamp(1 - (Math.max(0, fit.x + fit.width) - fit.x) / fit.width, 0.04, 0.28);
      const viewRight = clamp(1 - (Math.max(0, -fit.x)) / fit.width, 0.72, 0.96);
      const wideMin = clamp(Math.min(0.08, viewLeft + 0.05), 0.05, 0.22);
      const wideMax = clamp(Math.max(0.92, viewRight - 0.05), 0.78, 0.95);
      const laneIndex = laneOrder[this.serial % laneOrder.length];
      const laneSpan = (wideMax - wideMin) / 5;
      const baseX = clamp(wideMin + (laneIndex + 0.15 + Math.random() * 0.7) * laneSpan, 0.06, 0.94);

      const visibleTop = clamp(-fit.y / fit.height + 0.03, -0.55, 0.32);
      const speedBase = this.gentle ? (fever ? 0.27 : 0.22) : (fever ? 0.35 : 0.29);
      const vy = speedBase * (kind === 'bomb' ? 1.08 : kind === 'gold' ? 1.12 : kind === 'big' ? 0.88 : 1) * (0.9 + Math.random() * 0.2);
      this.items.push({
        id: (kind === 'bomb' ? 'bomb-' : 'heart-') + (++this.serial),
        playerId: zone.playerId,
        x: baseX,
        baseX,
        y: visibleTop,
        vy,
        swayAmp: kind === 'bomb' ? 0.008 : 0.014 + Math.random() * 0.02,
        swaySpeed: 1.8 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        radius: pxRadius / fit.height,
        kind,
        art: kind === 'bomb' ? 'bomb' : treasureForTier(kind, this.serial),
        points,
        color,
        age: 0,
      });
    }

    const visibleBottom = Math.min(1.04, (fit.height - fit.y) / fit.height + 0.05);
    const kept: FallingItem[] = [];
    let missedHearts = 0;
    for (const item of this.items) {
      item.age += delta;
      item.y += item.vy * dt;
      item.x = clamp(item.baseX + Math.sin(item.age * 0.001 * item.swaySpeed + item.phase) * item.swayAmp, 0.05, 0.95);
      if (item.y > visibleBottom) {
        if (item.kind !== 'bomb') missedHearts += 1;
      } else {
        kept.push(item);
      }
    }
    this.items = kept;
    if (missedHearts > 0) this.onMiss();

    for (const burst of this.bursts) {
      burst.age += delta;
      burst.x += burst.vx * dt;
      burst.y += burst.vy * dt;
      burst.vy += delta * (burst.smoke ? -0.05 : 0.14);
    }
    this.bursts = this.bursts.filter(burst => burst.age < (burst.smoke ? 820 : 620));

    for (const label of this.popTexts) {
      label.age += delta;
      label.y -= delta * 0.075;
    }
    this.popTexts = this.popTexts.filter(label => label.age < 860);
  }

  hands(pairs: CatchPair[], fit: Rect, _now?: number): void {
    this.catchers = pairs.map(pair => ({
      playerId: pair.playerId,
      left: validPoint(pair.left) ? { ...pair.left } : null,
      right: validPoint(pair.right) ? { ...pair.right } : null,
      shoulderWidth: Number.isFinite(pair.shoulderWidth) && pair.shoulderWidth > 0 ? pair.shoulderWidth : 0.18,
    }));
    this.collect(fit);
  }

  pointer(stagePoint: Point, fit: Rect, _now?: number): void {
    if (!Number.isFinite(stagePoint.x) || !Number.isFinite(stagePoint.y) || fit.width <= 0 || fit.height <= 0) return;
    const normX = clamp(1 - (stagePoint.x - fit.x) / fit.width, 0.04, 0.96);
    const normY = clamp((stagePoint.y - fit.y) / fit.height, 0.04, 0.96);
    const span = 0.07;
    this.catchers = [{
      playerId: 1,
      left: { x: Math.min(0.98, normX + span), y: normY },
      right: { x: Math.max(0.02, normX - span), y: normY },
      shoulderWidth: 0.16,
    }];
    this.collect(fit);
  }

  private collect(fit: Rect): void {
    if (!this.catchers.length || !this.items.length) return;
    const segments = this.catchers.map(pair => basketSegment(pair, fit)).filter((segment): segment is BasketSegment => segment !== null);
    if (!segments.length) return;
    const remaining: FallingItem[] = [];
    for (const item of this.items) {
      const center = toStage(item, fit);
      const itemRadius = item.radius * fit.height;
      const catchRadius = item.kind === 'bomb' ? itemRadius * 1.02 + 8 : itemRadius * (this.gentle ? 1.38 : 1.2) + 12;
      const catcher = segments.find(segment => intersectsSweep(segment.start, segment.end, { ...center, radius: catchRadius }));
      if (!catcher) {
        remaining.push(item);
        continue;
      }
      if (item.kind === 'bomb') {
        if (this.onBomb({ id: item.id, playerId: catcher.playerId, points: item.points })) {
          const costume = this.costumes.trigger(catcher.playerId, Math.random());
          for (let i = 0; i < 16; i++) {
            const angle = (i * Math.PI * 2) / 16 + (Math.random() - 0.5) * 0.25;
            const speed = 70 + Math.random() * 140;
            const isSmoke = i % 3 !== 0;
            this.bursts.push({
              x: center.x,
              y: center.y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 40,
              age: 0,
              size: isSmoke ? 12 + Math.random() * 10 : 7,
              color: isSmoke ? (i % 2 === 0 ? '#241e2e' : '#534c61') : '#ff8c3b',
              smoke: isSmoke,
            });
          }
          this.bursts = this.bursts.slice(-140);
          this.popTexts.push({ x: center.x, y: center.y - itemRadius * 0.5, text: '变身' + faceNames[costume] + '！', color: '#593a71', age: 0 });
          this.popTexts = this.popTexts.slice(-24);
        } else {
          remaining.push(item);
        }
        continue;
      }
      if (this.onCatch({ id: item.id, playerId: catcher.playerId, points: item.points, golden: item.kind === 'gold', kind: item.kind })) {
        this.pulseAge = 0;
        const count = item.kind === 'gold' ? 14 : 9;
        for (let i = 0; i < count; i++) {
          const angle = (i * Math.PI * 2) / count + (Math.random() - 0.5) * 0.3;
          const speed = 95 + Math.random() * 120;
          this.bursts.push({
            x: center.x,
            y: center.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 60,
            age: 0,
            size: item.kind === 'gold' ? 7 : 5.5,
            color: i % 2 === 0 ? item.color : '#fff2a6',
            smoke: false,
          });
        }
        this.bursts = this.bursts.slice(-140);
        this.popTexts.push({
          x: center.x,
          y: center.y - itemRadius * 0.5,
          text: '+' + item.points,
          color: item.kind === 'gold' ? '#9a6b0e' : '#7b395c',
          age: 0,
        });
        this.popTexts = this.popTexts.slice(-24);
      } else {
        remaining.push(item);
      }
    }
    this.items = remaining;
  }

  draw(ctx: CanvasRenderingContext2D, fit: Rect): void {
    const pulse = this.pulseAge < 260 ? 1 + Math.sin((this.pulseAge / 260) * Math.PI) * 0.14 : 1;
    this.catchers.forEach((pair, index) => {
      const segment = basketSegment(pair, fit);
      if (!segment) return;
      const stroke = index ? '#f47d5b' : '#5ba991';
      const fill = index ? '#fde2daee' : '#d8f3e9ee';
      const half = (segment.width / 2) * pulse;
      const depth = Math.min(34, Math.max(20, segment.width * 0.24)) * pulse;

      ctx.save();
      ctx.translate(segment.center.x, segment.center.y);
      ctx.rotate(segment.angle);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(-half, -2);
      ctx.quadraticCurveTo(0, depth * 1.45, half, -2);
      ctx.quadraticCurveTo(0, depth * 0.35, -half, -2);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-half, -2);
      ctx.quadraticCurveTo(0, depth * 0.35, half, -2);
      ctx.strokeStyle = '#ffffffdd';
      ctx.lineWidth = 3;
      ctx.stroke();

      for (const endX of [-half, half]) {
        ctx.beginPath();
        ctx.arc(endX, -2, 8 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      drawHeartShape(ctx, 0, depth * 0.52, 9 * pulse, 0, '#fff7fb', stroke, false);
      ctx.restore();
    });

    for (const item of this.items) {
      const p = toStage(item, fit);
      const r = item.radius * fit.height;
      const tilt = Math.sin(item.age * 0.0028 + item.phase) * (item.kind === 'bomb' ? 0.12 : 0.16);
      if (item.art && drawTreasure(ctx, item.art, p.x, p.y, r, tilt, item.points)) continue;
      if (item.kind === 'bomb') drawBombShape(ctx, p.x, p.y, r, tilt, item.age);
      else drawHeartShape(ctx, p.x, p.y, r, tilt, item.color, '#302744', item.kind === 'gold');
    }

    for (const burst of this.bursts) {
      ctx.save();
      const maxAge = burst.smoke ? 820 : 620;
      ctx.globalAlpha = Math.max(0, 1 - burst.age / maxAge);
      if (burst.smoke) {
        ctx.fillStyle = burst.color;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, burst.size * (1 + burst.age / maxAge * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        drawHeartShape(ctx, burst.x, burst.y, burst.size, burst.age * 0.006, burst.color, '#ffffff', false);
      }
      ctx.restore();
    }

    for (const label of this.popTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - label.age / 860);
      ctx.font = '800 25px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
      ctx.restore();
    }
  }
}
