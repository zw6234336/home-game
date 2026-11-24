import type { Point, Rect, TrackedPlayer } from '../types.ts';
import type { FaceEffect } from './costumes.ts';
import type { StageField } from '../ui/stage.ts';
import { intersectsSweep, toStage, validLandmark } from '../interaction/geometry.ts';
import { drawPinkBunnyFace, drawPrincessFace } from '../ui/gate-costumes.ts';

export type GateKind = 'duck' | 'left' | 'right' | 'reach' | 'step-near' | 'step-far';
export type GateTransformKind = 'princess' | 'pink-bunny';

export type GateEvent = {
  id: number;
  kind: GateKind;
  points: number;
  outcome: 'perfect' | 'shielded' | 'missed';
};

export type GateMeta = {
  readonly kind: GateKind;
  readonly title: string;
  readonly prompt: string;
  readonly badge: string;
  readonly accent: string;
};

const GATE_INFO: Record<GateKind, GateMeta> = {
  duck: { kind: 'duck', title: '能量横杆', prompt: '一起下蹲钻过去！', badge: '下蹲', accent: '#f08b7d' },
  left: { kind: 'left', title: '左星安全门', prompt: '快往左边绿区滑步！', badge: '向左', accent: '#58b79b' },
  right: { kind: 'right', title: '右星安全门', prompt: '快往右边绿区滑步！', badge: '向右', accent: '#58b79b' },
  reach: { kind: 'reach', title: '双星能量门', prompt: '举起双手冲过星门！', badge: '举手', accent: '#f0b84f' },
  'step-near': { kind: 'step-near', title: '前排景深环', prompt: '往前跨一步，踩亮星环！', badge: '前跨', accent: '#4da8d8' },
  'step-far': { kind: 'step-far', title: '后排景深环', prompt: '往后退一步，踩亮星环！', badge: '后退', accent: '#8c72c8' },
};

type ActiveGate = {
  id: number;
  kind: GateKind;
  progress: number;
  durationMs: number;
  shieldStar: { x: number; y: number; collected: boolean } | null;
};

type PlayerBaseline = {
  shoulderY: number;
  shoulderWidth: number;
  depthMeters: number | null;
};

type PlayerEval = {
  id: number;
  screenX: number;
  screenY: number;
  safe: boolean;
  depthMeters: number | null;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  age: number;
  life: number;
};

type Banner = {
  text: string;
  color: string;
  age: number;
  life: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shoulderCenterY(player: TrackedPlayer): number {
  const s11 = validLandmark(player.landmarks[11]) ? player.landmarks[11] : null;
  const s12 = validLandmark(player.landmarks[12]) ? player.landmarks[12] : null;
  if (s11 && s12) return (s11.y + s12.y) / 2;
  return player.center.y;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStarShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export class SpaceGatesField implements StageField {
  private readonly expectedPlayers: 1 | 2;
  private readonly gentle: boolean;
  private readonly onGateResolve: (event: GateEvent) => void;
  private readonly onShieldCollect: () => void;
  private readonly random: () => number;
  private remainingMs = 60000;
  private elapsedMs = 0;
  private nextId = 1;
  private gate: ActiveGate | null = null;
  private cooldownMs = 350;
  private lastKind: GateKind | null = null;
  private baselines = new Map<number, PlayerBaseline>();
  private evaluations: PlayerEval[] = [];
  private prevHands = new Map<string, Point>();
  private teamShield = false;
  private passedCount = 0;
  private rescueCount = 0;
  private missedCount = 0;
  private demoPoint: Point | null = null;
  private demoDepthMode: 'neutral' | 'near' | 'far' = 'neutral';
  private particles: Particle[] = [];
  private banner: Banner | null = null;
  private tunnelPhase = 0;
  private forms = new Map<number, { kind: GateTransformKind; changedAt: number }>();
  private lastFit: Rect = { x: 0, y: 0, width: 1280, height: 720 };

  constructor(
    expectedPlayers: 1 | 2,
    gentle: boolean,
    onGateResolve: (event: GateEvent) => void,
    onShieldCollect: () => void = () => {},
    random: () => number = Math.random,
  ) {
    this.expectedPlayers = expectedPlayers;
    this.gentle = gentle;
    this.onGateResolve = onGateResolve;
    this.onShieldCollect = onShieldCollect;
    this.random = random;
  }

  get stats() {
    return {
      passed: this.passedCount,
      rescues: this.rescueCount,
      missed: this.missedCount,
      shieldActive: this.teamShield,
      currentGate: this.gate ? { id: this.gate.id, kind: this.gate.kind, progress: this.gate.progress } : null,
    };
  }

  waveLabel(): string {
    if (this.gate) return GATE_INFO[this.gate.kind].prompt;
    if (this.remainingMs > 40000) return '太空起航 · 跟着星门指示动起来！';
    if (this.remainingMs > 15000) return '星际穿梭 · 注意前跨与后退景深星环！';
    return '超光速冲刺 · 全员配合连穿星门！';
  }

  setRemainingMs(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.remainingMs = ms;
  }

  clearTrails(): void {
    this.prevHands.clear();
  }

  faceEffect(playerId: number): FaceEffect | null {
    const form = this.forms.get(playerId);
    if (!form) return null;
    return {
      kind: form.kind,
      alpha: 1,
      elapsedMs: Math.max(0, this.elapsedMs - form.changedAt),
    };
  }

  private syncForm(id: number, safe: boolean, screenX: number, screenY: number, fit: Rect): GateTransformKind {
    const nextKind: GateTransformKind = safe ? 'princess' : 'pink-bunny';
    const prev = this.forms.get(id);
    if (!prev || prev.kind !== nextKind) {
      this.forms.set(id, { kind: nextKind, changedAt: this.elapsedMs });
      this.emitParticles(
        fit.x + screenX * fit.width,
        fit.y + screenY * fit.height,
        nextKind === 'princess' ? '#f7d263' : '#f59bc0',
        12,
      );
    }
    return nextKind;
  }

  pointer(point: Point, fit: Rect, clicked = false): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || fit.width <= 0 || fit.height <= 0) return;
    this.lastFit = fit;
    const nx = clamp((point.x - fit.x) / fit.width, 0.02, 0.98);
    const ny = clamp((point.y - fit.y) / fit.height, 0.02, 0.98);
    this.demoPoint = { x: nx, y: ny };
    if (clicked && this.gate) {
      if (this.gate.kind === 'step-near') this.demoDepthMode = 'near';
      else if (this.gate.kind === 'step-far') this.demoDepthMode = 'far';
    }
    this.checkShieldTouch('demo-mouse', { x: nx, y: ny }, fit);
    this.evaluateDemo(fit);
  }

  observePlayers(players: TrackedPlayer[], fit: Rect): void {
    this.demoPoint = null;
    this.lastFit = fit;
    const evals: PlayerEval[] = [];
    for (const player of players) {
      const sy = shoulderCenterY(player);
      const sw = clamp(player.shoulderWidth, 0.03, 0.55);
      const depth = typeof player.depthMeters === 'number' && Number.isFinite(player.depthMeters) ? player.depthMeters : null;
      let base = this.baselines.get(player.id);
      if (!base) {
        base = { shoulderY: sy, shoulderWidth: sw, depthMeters: depth };
        this.baselines.set(player.id, base);
      } else {
        const allowYAdapt = !this.gate || this.gate.kind !== 'duck';
        const allowDepthAdapt = !this.gate || (this.gate.kind !== 'step-near' && this.gate.kind !== 'step-far');
        if (allowYAdapt && sy < base.shoulderY + 0.04) {
          base.shoulderY = base.shoulderY * 0.96 + sy * 0.04;
        }
        if (allowDepthAdapt) {
          base.shoulderWidth = base.shoulderWidth * 0.97 + sw * 0.03;
          if (depth !== null) {
            base.depthMeters = base.depthMeters === null ? depth : base.depthMeters * 0.95 + depth * 0.05;
          }
        }
      }
      const screenX = clamp(1 - player.center.x, 0.02, 0.98);
      const screenY = clamp(sy, 0.05, 0.95);
      let safe = true;
      if (this.gate) {
        safe = this.isPlayerSafe(player, base, screenX, sy, depth, this.gate.kind);
        this.syncForm(player.id, safe, screenX, screenY, fit);
      } else {
        const locked = this.forms.get(player.id);
        safe = locked ? locked.kind === 'princess' : true;
      }
      evals.push({ id: player.id, screenX, screenY, safe, depthMeters: depth });
      for (let side = 0; side < 2; side += 1) {
        const wrist = player.wrists[side];
        const key = player.id + '-' + side;
        if (!wrist) {
          this.prevHands.delete(key);
          continue;
        }
        const stagePoint = toStage(wrist, fit, true);
        const norm = {
          x: fit.width > 0 ? clamp((stagePoint.x - fit.x) / fit.width, 0, 1) : 1 - wrist.x,
          y: fit.height > 0 ? clamp((stagePoint.y - fit.y) / fit.height, 0, 1) : wrist.y,
        };
        this.checkShieldTouch(key, norm, fit);
      }
    }
    this.evaluations = evals;
  }

  update(deltaMs: number, fit: Rect): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    if (fit.width > 0 && fit.height > 0) this.lastFit = fit;
    const dt = Math.min(deltaMs, 100);
    this.elapsedMs += dt;
    this.tunnelPhase = (this.tunnelPhase + dt * 0.00055) % 1;
    this.updateEffects(dt);
    if (this.demoPoint) this.evaluateDemo(this.lastFit);
    if (!this.gate) {
      this.cooldownMs -= dt;
      if (this.cooldownMs <= 0) this.spawnGate();
      return;
    }
    this.gate.progress += dt / this.gate.durationMs;
    if (this.gate.progress >= 1) {
      this.resolveGate(this.lastFit);
    }
  }

  private evaluateDemo(fit: Rect = this.lastFit): void {
    if (!this.demoPoint) return;
    const p = this.demoPoint;
    let safe = true;
    if (this.gate) {
      const kind = this.gate.kind;
      if (kind === 'left') safe = p.x <= 0.52;
      else if (kind === 'right') safe = p.x >= 0.48;
      else if (kind === 'duck') safe = p.y >= 0.6;
      else if (kind === 'reach') safe = p.y <= 0.36;
      else if (kind === 'step-near') safe = this.demoDepthMode === 'near' || Math.hypot(p.x - 0.5, p.y - 0.58) <= 0.22;
      else if (kind === 'step-far') safe = this.demoDepthMode === 'far' || Math.hypot(p.x - 0.5, p.y - 0.38) <= 0.22;
      this.syncForm(1, safe, p.x, p.y, fit);
    } else {
      const locked = this.forms.get(1);
      safe = locked ? locked.kind === 'princess' : true;
    }
    this.evaluations = [{ id: 1, screenX: p.x, screenY: p.y, safe, depthMeters: null }];
  }

  private isPlayerSafe(
    player: TrackedPlayer,
    base: PlayerBaseline,
    screenX: number,
    shoulderY: number,
    depth: number | null,
    kind: GateKind,
  ): boolean {
    if (kind === 'left') return screenX <= (this.gentle ? 0.54 : 0.5);
    if (kind === 'right') return screenX >= (this.gentle ? 0.46 : 0.5);
    if (kind === 'duck') {
      const drop = shoulderY - base.shoulderY;
      return drop >= (this.gentle ? 0.07 : 0.1) || shoulderY >= (this.gentle ? 0.58 : 0.63);
    }
    if (kind === 'reach') return this.gentle ? player.raised : player.bothRaised;
    if (kind === 'step-near') {
      if (depth !== null && base.depthMeters !== null) {
        return base.depthMeters - depth >= (this.gentle ? 0.18 : 0.24);
      }
      return player.shoulderWidth / Math.max(0.03, base.shoulderWidth) >= (this.gentle ? 1.13 : 1.18);
    }
    if (kind === 'step-far') {
      if (depth !== null && base.depthMeters !== null) {
        return depth - base.depthMeters >= (this.gentle ? 0.18 : 0.24);
      }
      return player.shoulderWidth / Math.max(0.03, base.shoulderWidth) <= (this.gentle ? 0.88 : 0.84);
    }
    return true;
  }

  private checkShieldTouch(handKey: string, normPoint: Point, fit: Rect): void {
    const prev = this.prevHands.get(handKey) ?? null;
    this.prevHands.set(handKey, normPoint);
    if (!this.gate?.shieldStar || this.gate.shieldStar.collected || this.teamShield || this.gate.progress < 0.16) return;
    const star = this.gate.shieldStar;
    const hitRadius = this.gentle ? 0.11 : 0.085;
    if (intersectsSweep(prev, normPoint, { x: star.x, y: star.y, radius: hitRadius })) {
      star.collected = true;
      this.teamShield = true;
      this.onShieldCollect();
      this.banner = { text: '同伴护盾已充能！', color: '#e6a62c', age: 0, life: 1300 };
      this.emitParticles(fit.x + star.x * fit.width, fit.y + star.y * fit.height, '#f6c858', 18);
    }
  }

  private spawnGate(): void {
    const wave = this.remainingMs > 40000 ? 1 : this.remainingMs > 15000 ? 2 : 3;
    const pool: GateKind[] = wave === 1
      ? ['left', 'right', 'duck', 'reach']
      : ['left', 'right', 'duck', 'reach', 'step-near', 'step-far'];
    const filtered = pool.filter(item => item !== this.lastKind);
    const kind = filtered[Math.floor(this.random() * filtered.length) % filtered.length];
    this.lastKind = kind;
    this.demoDepthMode = 'neutral';
    const baseMs = wave === 1 ? (this.gentle ? 5000 : 4400) : wave === 2 ? (this.gentle ? 4300 : 3700) : (this.gentle ? 3700 : 3100);
    const shouldOfferShield = !this.teamShield && (this.expectedPlayers === 2 || this.nextId % 2 === 0);
    const starX = kind === 'left' ? 0.28 : kind === 'right' ? 0.72 : 0.25 + this.random() * 0.5;
    const starY = kind === 'duck' ? 0.66 : 0.34 + this.random() * 0.18;
    this.gate = {
      id: this.nextId++,
      kind,
      progress: 0,
      durationMs: baseMs,
      shieldStar: shouldOfferShield ? { x: starX, y: starY, collected: false } : null,
    };
    if (this.demoPoint) this.evaluateDemo(this.lastFit);
  }

  private resolveGate(fit: Rect): void {
    const current = this.gate!;
    for (const item of this.evaluations) {
      this.syncForm(item.id, item.safe, item.screenX, item.screenY, fit);
    }
    this.gate = null;
    this.cooldownMs = this.gentle ? 700 : 500;
    const allSafe = this.evaluations.length > 0 && this.evaluations.every(item => item.safe);
    const cx = fit.x + fit.width / 2;
    const cy = fit.y + fit.height * 0.46;
    if (allSafe) {
      this.passedCount += 1;
      this.banner = { text: '全员变身小公主 +50！', color: '#2f8f72', age: 0, life: 1300 };
      this.emitParticles(cx, cy, '#58c7a3', 24);
      this.onGateResolve({ id: current.id, kind: current.kind, points: 50, outcome: 'perfect' });
      return;
    }
    if (this.teamShield) {
      this.teamShield = false;
      this.passedCount += 1;
      this.rescueCount += 1;
      this.banner = { text: '护盾救场 +40！', color: '#d48d1d', age: 0, life: 1400 };
      this.emitParticles(cx, cy, '#f4c552', 22);
      this.onGateResolve({ id: current.id, kind: current.kind, points: 40, outcome: 'shielded' });
      return;
    }
    this.missedCount += 1;
    this.banner = { text: '变身粉色毛兔！快冲进安全区', color: '#dc6494', age: 0, life: 1200 };
    this.emitParticles(cx, cy, '#f69fc2', 14);
    this.onGateResolve({ id: current.id, kind: current.kind, points: 0, outcome: 'missed' });
  }

  private emitParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + this.random() * 0.35;
      const speed = 90 + this.random() * 190;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 35,
        radius: 5 + this.random() * 6,
        color,
        age: 0,
        life: 650 + this.random() * 350,
      });
    }
  }

  private updateEffects(dt: number): void {
    const sec = dt / 1000;
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * sec;
      p.y += p.vy * sec;
      p.vy += 260 * sec;
    }
    this.particles = this.particles.filter(p => p.age < p.life);
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.life) this.banner = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, fit: Rect): void {
    if (fit.width <= 0 || fit.height <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.x, fit.y, fit.width, fit.height);
    ctx.clip();
    this.drawCosmicTunnel(ctx, fit);
    if (this.gate) this.drawGate(ctx, fit, this.gate);
    this.drawPlayerHalos(ctx, fit);
    if (this.teamShield) this.drawTeamShieldFrame(ctx, fit);
    this.drawParticles(ctx);
    if (this.gate) this.drawTopPrompt(ctx, fit, this.gate);
    if (this.banner) this.drawBanner(ctx, fit, this.banner);
    ctx.restore();
  }

  private drawCosmicTunnel(ctx: CanvasRenderingContext2D, fit: Rect): void {
    const cx = fit.x + fit.width / 2;
    const cy = fit.y + fit.height / 2;
    ctx.strokeStyle = 'rgba(136, 114, 198, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const t = (this.tunnelPhase + i * 0.25) % 1;
      const scale = 0.2 + 0.85 * t * t;
      const rw = fit.width * scale;
      const rh = fit.height * scale;
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.45;
      drawRoundedRect(ctx, cx - rw / 2, cy - rh / 2, rw, rh, 28 * scale);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawGate(ctx: CanvasRenderingContext2D, fit: Rect, gate: ActiveGate): void {
    const p = clamp(gate.progress, 0, 1);
    const scale = 0.24 + 0.76 * Math.pow(p, 1.35);
    const gw = fit.width * scale;
    const gh = fit.height * scale;
    const gx = fit.x + (fit.width - gw) / 2;
    const gy = fit.y + (fit.height - gh) / 2;
    const alpha = 0.28 + 0.58 * p;

    if (gate.kind === 'left' || gate.kind === 'right') {
      const safeLeft = gate.kind === 'left';
      const safeX = safeLeft ? gx : gx + gw / 2;
      const blockX = safeLeft ? gx + gw / 2 : gx;
      ctx.fillStyle = `rgba(92, 196, 162, ${0.14 + 0.16 * p})`;
      drawRoundedRect(ctx, safeX + 4, gy + 4, gw / 2 - 8, gh - 8, 22 * scale);
      ctx.fill();
      ctx.strokeStyle = `rgba(74, 184, 148, ${alpha})`;
      ctx.lineWidth = Math.max(3, 7 * scale);
      ctx.stroke();

      ctx.fillStyle = `rgba(235, 116, 108, ${0.16 + 0.24 * p})`;
      drawRoundedRect(ctx, blockX + 4, gy + 4, gw / 2 - 8, gh - 8, 22 * scale);
      ctx.fill();
      ctx.strokeStyle = `rgba(220, 88, 84, ${alpha})`;
      ctx.lineWidth = Math.max(3, 6 * scale);
      ctx.stroke();

      const halfBox = Math.max(40, gw / 2 - 18);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.font = `800 ${Math.round(clamp(28 * scale, 11, 26))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(safeLeft ? '← 变公主' : '变公主 →', safeX + gw / 4, gy + gh * 0.5, halfBox);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `800 ${Math.round(clamp(24 * scale, 11, 22))}px system-ui, -apple-system, sans-serif`;
      ctx.fillText('变粉兔', blockX + gw / 4, gy + gh * 0.5, halfBox);
    } else if (gate.kind === 'duck') {
      const barH = gh * 0.52;
      ctx.fillStyle = `rgba(235, 116, 108, ${0.16 + 0.24 * p})`;
      drawRoundedRect(ctx, gx + 4, gy + 4, gw - 8, barH, 20 * scale);
      ctx.fill();
      ctx.strokeStyle = `rgba(220, 88, 84, ${alpha})`;
      ctx.lineWidth = Math.max(3, 6 * scale);
      ctx.stroke();

      ctx.fillStyle = `rgba(92, 196, 162, ${0.14 + 0.16 * p})`;
      drawRoundedRect(ctx, gx + 4, gy + barH + 10, gw - 8, gh - barH - 14, 20 * scale);
      ctx.fill();
      ctx.strokeStyle = `rgba(74, 184, 148, ${alpha})`;
      ctx.stroke();

      const fullBox = Math.max(70, gw - 24);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `800 ${Math.round(clamp(24 * scale, 11, 22))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('危险区 · 变粉兔', gx + gw / 2, gy + barH * 0.54, fullBox);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.font = `800 ${Math.round(clamp(28 * scale, 12, 26))}px system-ui, -apple-system, sans-serif`;
      ctx.fillText('↓ 下蹲 · 变公主 ↓', gx + gw / 2, gy + barH + (gh - barH) * 0.5, fullBox);
    } else if (gate.kind === 'reach') {
      ctx.strokeStyle = `rgba(240, 184, 79, ${alpha})`;
      ctx.lineWidth = Math.max(4, 10 * scale);
      ctx.beginPath();
      ctx.arc(gx + gw / 2, gy + gh * 0.62, gw * 0.42, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(246, 204, 98, ${0.25 + 0.35 * p})`;
      drawStarShape(ctx, gx + gw * 0.25, gy + gh * 0.28, 28 * scale, 13 * scale);
      ctx.fill();
      drawStarShape(ctx, gx + gw * 0.75, gy + gh * 0.28, 28 * scale, 13 * scale);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.font = `800 ${Math.round(Math.max(17, 30 * scale))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↑ 高举双手 · 变公主 ↑', gx + gw / 2, gy + gh * 0.24);
    } else {
      const isNear = gate.kind === 'step-near';
      const ringColor = isNear ? '77, 168, 216' : '140, 114, 200';
      const ringCx = fit.x + fit.width / 2;
      const ringCy = fit.y + fit.height * (isNear ? 0.58 : 0.44);
      const ringRx = fit.width * (isNear ? 0.32 * scale : 0.26 * (1.2 - 0.35 * p));
      const ringRy = fit.height * (isNear ? 0.24 * scale : 0.19 * (1.2 - 0.35 * p));
      ctx.fillStyle = `rgba(${ringColor}, ${0.12 + 0.18 * p})`;
      ctx.beginPath();
      ctx.ellipse(ringCx, ringCy, ringRx, ringRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${ringColor}, ${alpha})`;
      ctx.lineWidth = Math.max(4, 9 * scale);
      ctx.stroke();
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.ellipse(ringCx, ringCy, ringRx * 0.72, ringRy * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.font = `800 ${Math.round(Math.max(16, 28 * scale))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isNear ? '向前跨一步 · 变公主！' : '向后退一步 · 变公主！', ringCx, ringCy);
    }

    if (gate.shieldStar && !gate.shieldStar.collected && !this.teamShield && p >= 0.16) {
      const sx = fit.x + gate.shieldStar.x * fit.width;
      const sy = fit.y + gate.shieldStar.y * fit.height;
      const pulse = 1 + Math.sin(this.elapsedMs * 0.01) * 0.12;
      const r = Math.max(24, fit.width * 0.032) * pulse;
      ctx.fillStyle = 'rgba(250, 204, 86, 0.92)';
      drawStarShape(ctx, sx, sy, r, r * 0.48);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#5c4110';
      ctx.font = '800 13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('护盾', sx, sy + 1);
    }
  }

  private drawPlayerHalos(ctx: CanvasRenderingContext2D, fit: Rect): void {
    for (const item of this.evaluations) {
      const px = fit.x + item.screenX * fit.width;
      const py = fit.y + item.screenY * fit.height;
      const radius = Math.max(26, fit.width * 0.036);
      const form = this.forms.get(item.id);
      const isPrincess = form ? form.kind === 'princess' : item.safe;
      const elapsed = form ? Math.max(0, this.elapsedMs - form.changedAt) : this.elapsedMs;

      if (isPrincess) {
        ctx.strokeStyle = '#39b98d';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = '#f6cf5d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, radius + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        for (let i = 0; i < 4; i += 1) {
          const theta = elapsed * 0.002 + (i * Math.PI) / 2;
          const sx = px + Math.cos(theta) * (radius + 9);
          const sy = py + Math.sin(theta) * (radius + 9);
          ctx.fillStyle = '#ffe27a';
          drawStarShape(ctx, sx, sy, 6, 2.5);
          ctx.fill();
        }
      } else {
        ctx.strokeStyle = '#ee7aa8';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 8; i += 1) {
          const theta = -elapsed * 0.0018 + (i * Math.PI) / 4;
          const bx = px + Math.cos(theta) * (radius + 5);
          const by = py + Math.sin(theta) * (radius + 5);
          ctx.fillStyle = '#fbb9d3';
          ctx.beginPath();
          ctx.arc(bx, by, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (this.demoPoint && item.id === 1) {
        const ax = fit.x + this.demoPoint.x * fit.width;
        const ay = fit.y + this.demoPoint.y * fit.height;
        ctx.fillStyle = '#fff9f5';
        ctx.beginPath();
        ctx.arc(ax, ay, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isPrincess ? '#f6cf5d' : '#f278a8';
        ctx.lineWidth = 3.5;
        ctx.stroke();
        if (isPrincess) drawPrincessFace(ctx, { x: ax, y: ay + 2, size: 42, angle: 0 }, 1, elapsed, true);
        else drawPinkBunnyFace(ctx, { x: ax, y: ay + 4, size: 38, angle: 0 }, 1, elapsed);
      }

      const tagW = 128;
      const tagH = 28;
      const tagY = Math.min(fit.y + fit.height - tagH - 8, py + radius + 14);
      ctx.fillStyle = isPrincess ? 'rgba(40, 167, 127, 0.92)' : 'rgba(224, 92, 144, 0.92)';
      drawRoundedRect(ctx, px - tagW / 2, tagY, tagW, tagH, 14);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '750 13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isPrincess ? '安全区 · 小公主' : '危险区 · 粉色毛兔', px, tagY + tagH / 2);
    }
  }

  private drawTeamShieldFrame(ctx: CanvasRenderingContext2D, fit: Rect): void {
    ctx.strokeStyle = 'rgba(246, 200, 82, 0.85)';
    ctx.lineWidth = 10;
    drawRoundedRect(ctx, fit.x + 8, fit.y + 8, fit.width - 16, fit.height - 16, 22);
    ctx.stroke();
  }

  private drawTopPrompt(ctx: CanvasRenderingContext2D, fit: Rect, gate: ActiveGate): void {
    const info = GATE_INFO[gate.kind];
    const pillW = Math.min(fit.width * 0.72, 460);
    const pillH = 54;
    const px = fit.x + (fit.width - pillW) / 2;
    const py = fit.y + 18;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    drawRoundedRect(ctx, px, py, pillW, pillH, 27);
    ctx.fill();
    ctx.strokeStyle = info.accent;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = info.accent;
    drawRoundedRect(ctx, px + 10, py + 9, 68, 36, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.badge, px + 44, py + 27);

    ctx.fillStyle = '#2d243b';
    ctx.font = '800 22px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(info.prompt, px + 92, py + 25);

    const barX = px + 92;
    const barY = py + 41;
    const barW = pillW - 112;
    ctx.fillStyle = '#ebe5f5';
    drawRoundedRect(ctx, barX, barY, barW, 6, 3);
    ctx.fill();
    ctx.fillStyle = info.accent;
    drawRoundedRect(ctx, barX, barY, barW * clamp(gate.progress, 0, 1), 6, 3);
    ctx.fill();
  }

  private drawBanner(ctx: CanvasRenderingContext2D, fit: Rect, banner: Banner): void {
    const t = banner.age / banner.life;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const bw = Math.min(fit.width * 0.78, 410);
    const bh = 56;
    const bx = fit.x + (fit.width - bw) / 2;
    const by = fit.y + fit.height * 0.22 - t * 24;
    ctx.fillStyle = banner.color;
    drawRoundedRect(ctx, bx, by, bw, bh, 28);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, bx + bw / 2, by + bh / 2);
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const alpha = Math.max(0, 1 - p.age / p.life);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      drawStarShape(ctx, p.x, p.y, p.radius, p.radius * 0.45);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
