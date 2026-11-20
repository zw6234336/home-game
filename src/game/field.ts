import type { Point, ReachZone, Rect } from '../types.ts';
import { intersectsSweep, toStage } from '../interaction/geometry.ts';

type Bubble = Point & { id: string; radius: number; age: number; color: number; playerId: number };
type Spark = Point & { vx: number; vy: number; age: number; color: string };
export type HandPoint = { id: string; point: Point };
const colors = ['#f4a483', '#88cbb5', '#e6c873', '#b1a2e8'];

export class BubbleField {
  private bubbles: Bubble[] = [];
  private sparks: Spark[] = [];
  private previous = new Map<string, { point: Point; time: number }>();
  private serial = 0;
  private age = 1000;
  private zones: ReachZone[] = [];
  private gentle: boolean;
  private onHit: (id: string) => boolean;
  private onMiss: () => void;
  constructor(zones: ReachZone[], gentle: boolean, onHit: (id: string) => boolean, onMiss: () => void) {
    this.setZones(zones);
    this.gentle = gentle;
    this.onHit = onHit;
    this.onMiss = onMiss;
  }
  clearTrails() { this.previous.clear(); }
  setZones(zones: ReachZone[]) {
    const next = zones.filter(zone => [zone.playerId, zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) && zone.x >= 0 && zone.y >= 0 && zone.width > 0 && zone.height > 0 && zone.x + zone.width <= 1 && zone.y + zone.height <= 1).map(zone => ({ ...zone }));
    const changed = next.length !== this.zones.length || next.some(zone => {
      const previous = this.zones.find(item => item.playerId === zone.playerId);
      if (!previous) return true;
      const centerShift = Math.hypot(zone.x + zone.width / 2 - previous.x - previous.width / 2, zone.y + zone.height / 2 - previous.y - previous.height / 2);
      return centerShift > 0.08 || zone.width / previous.width > 1.25 || zone.width / previous.width < 0.8 || zone.height / previous.height > 1.25 || zone.height / previous.height < 0.8;
    });
    if (changed) this.clearTrails();
    this.zones = next;
    this.bubbles = this.bubbles.filter(bubble => next.some(zone => zone.playerId === bubble.playerId && bubble.x >= zone.x && bubble.x <= zone.x + zone.width && bubble.y >= zone.y && bubble.y <= zone.y + zone.height));
  }
  update(delta: number, fit: Rect) {
    if (!Number.isFinite(delta) || delta < 0 || !Number.isFinite(fit.height) || fit.height <= 0) return;
    this.age += delta;
    const interval = this.gentle ? 1100 : 750;
    if (this.age >= interval && this.bubbles.length < (this.gentle ? 4 : 6)) {
      this.age = 0;
      const zone = this.zones[this.serial % this.zones.length];
      if (zone) {
        const radius = Math.min(65, Math.max(24, fit.height * (this.gentle ? 0.072 : 0.052)));
        for (let attempt = 0; attempt < 20; attempt++) {
          const point = { x: zone.x + zone.width * (0.15 + Math.random() * 0.7), y: zone.y + zone.height * (0.15 + Math.random() * 0.7) };
          const position = toStage(point, fit);
          if (this.bubbles.some(other => { const p = toStage(other, fit); return Math.hypot(p.x - position.x, p.y - position.y) < radius + other.radius * fit.height + 12; })) continue;
          this.bubbles.push({ ...point, radius: radius / fit.height, age: 0, color: this.serial % colors.length, id: 'bubble-' + (++this.serial), playerId: zone.playerId });
          break;
        }
      }
    }
    for (const bubble of this.bubbles) bubble.age += delta;
    const expired = this.bubbles.filter(bubble => bubble.age >= (this.gentle ? 8500 : 5500));
    this.bubbles = this.bubbles.filter(bubble => !expired.includes(bubble));
    if (expired.length) this.onMiss();
    for (const spark of this.sparks) { spark.age += delta; spark.x += spark.vx * delta / 1000; spark.y += spark.vy * delta / 1000; spark.vy += delta * 0.08; }
    this.sparks = this.sparks.filter(spark => spark.age < 550);
  }
  hands(hands: HandPoint[], time: number, fit: Rect) {
    if (!Number.isFinite(time)) { this.clearTrails(); return; }
    const next = new Map<string, { point: Point; time: number }>();
    for (const hand of hands) {
      if (![hand.point.x, hand.point.y].every(Number.isFinite) || hand.point.x < 0 || hand.point.x > 1 || hand.point.y < 0 || hand.point.y > 1) continue;
      const point = toStage(hand.point, fit);
      const previous = this.previous.get(hand.id);
      const projected = previous ? toStage(previous.point, fit) : null;
      const before = previous && projected && time > previous.time && time - previous.time <= 150 && Math.hypot(point.x - projected.x, point.y - projected.y) < fit.width * 0.45 ? projected : null;
      this.strike(before, point, fit);
      next.set(hand.id, { point: { ...hand.point }, time });
    }
    this.previous = next;
  }
  pointer(point: Point, fit: Rect) { this.strike(null, point, fit); }
  private strike(before: Point | null, point: Point, fit: Rect) {
    for (const bubble of [...this.bubbles]) {
      const position = toStage(bubble, fit);
      if (!intersectsSweep(before, point, { ...position, radius: bubble.radius * fit.height * 1.25 }) || !this.onHit(bubble.id)) continue;
      this.bubbles = this.bubbles.filter(item => item !== bubble);
      for (let index = 0; index < 10; index++) {
        const angle = index * Math.PI / 5;
        this.sparks.push({ ...position, vx: Math.cos(angle) * 140, vy: Math.sin(angle) * 140 - 50, age: 0, color: colors[bubble.color] });
      }
      this.sparks = this.sparks.slice(-100);
    }
  }
  draw(ctx: CanvasRenderingContext2D, fit: Rect) {
    for (const bubble of this.bubbles) {
      const p = toStage(bubble, fit);
      const r = bubble.radius * fit.height;
      const gradient = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.03, p.x, p.y, r);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(0.2, '#ffffffd0');
      gradient.addColorStop(0.65, colors[bubble.color] + '80');
      gradient.addColorStop(1, colors[bubble.color]);
      ctx.fillStyle = gradient;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffffffdd'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.76, Math.PI * 1.1, Math.PI * 1.55); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.font = '600 ' + Math.round(r * 0.7) + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', p.x, p.y);
    }
    for (const spark of this.sparks) { ctx.globalAlpha = 1 - spark.age / 550; ctx.fillStyle = spark.color; ctx.beginPath(); ctx.arc(spark.x, spark.y, 4, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}
