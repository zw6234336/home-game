import type { Point, Rect, TrackedPlayer } from '../types.ts';
import type { StageField } from '../ui/stage.ts';
import { intersectsSweep, validLandmark } from '../interaction/geometry.ts';

export type BridgeEvent = {
  id: number;
  kind: 'escort' | 'star' | 'dodge' | 'missed' | 'zapped';
  points: number;
  golden?: boolean;
  linked?: boolean;
};

export type BridgeSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cooperative: boolean;
  playerId: number | null;
};

type PlayerBaseline = {
  shoulderY: number;
  depthMeters: number | null;
};

type PlayerEval = {
  id: number;
  screenX: number;
  screenY: number;
  ducking: boolean;
  depthMeters: number | null;
};

type Sprite = {
  id: number;
  x: number;
  y: number;
  vy: number;
  golden: boolean;
  falling: boolean;
  usedLink: boolean;
  bobPhase: number;
};

type SkyStar = {
  id: number;
  x: number;
  y: number;
  age: number;
};

type ThunderCloud = {
  id: number;
  x: number;
  remainingMs: number;
  totalMs: number;
};

type CloudFlash = {
  x: number;
  kind: 'dodge' | 'zap';
  age: number;
  life: number;
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

const RAINBOW_BANDS = ['#f28b82', '#f6c858', '#58c7a3', '#7ea8e8'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shoulderCenter(player: TrackedPlayer): Point {
  const s11 = validLandmark(player.landmarks[11]) ? player.landmarks[11] : null;
  const s12 = validLandmark(player.landmarks[12]) ? player.landmarks[12] : null;
  if (s11 && s12) return { x: (s11.x + s12.x) / 2, y: (s11.y + s12.y) / 2 };
  return player.center;
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

export class RainbowBridgeField implements StageField {
  private readonly expectedPlayers: 1 | 2;
  private readonly gentle: boolean;
  private readonly onEvent: (event: BridgeEvent) => void;
  private readonly onLinkChime: () => void;
  private readonly random: () => number;
  private remainingMs = 60000;
  private elapsedMs = 0;
  private nextId = 1;
  private spriteSpawnCount = 0;
  private spriteCooldownMs = 450;
  private starCooldownMs = 2200;
  private cloudCooldownMs = 1800;
  private baselines = new Map<number, PlayerBaseline>();
  private evaluations: PlayerEval[] = [];
  private segments: BridgeSegment[] = [];
  private sprites: Sprite[] = [];
  private skyStar: SkyStar | null = null;
  private cloud: ThunderCloud | null = null;
  private flash: CloudFlash | null = null;
  private particles: Particle[] = [];
  private banner: Banner | null = null;
  private demoPoint: Point | null = null;
  private lastDemoX: number | null = null;
  private demoTilt = 0;
  private linked = false;
  private tailwind = false;
  private escortedCount = 0;
  private dodgedCount = 0;
  private starsCount = 0;
  private missedCount = 0;

  constructor(
    expectedPlayers: 1 | 2,
    gentle: boolean,
    onEvent: (event: BridgeEvent) => void,
    onLinkChime: () => void = () => {},
    random: () => number = Math.random,
  ) {
    this.expectedPlayers = expectedPlayers;
    this.gentle = gentle;
    this.onEvent = onEvent;
    this.onLinkChime = onLinkChime;
    this.random = random;
  }

  get stats() {
    return {
      escorted: this.escortedCount,
      dodged: this.dodgedCount,
      stars: this.starsCount,
      missed: this.missedCount,
      linked: this.linked,
      tailwind: this.tailwind,
      activeSprites: this.sprites.length,
    };
  }

  waveLabel(): string {
    if (this.cloud) return '小雷云正在靠近！快一起下蹲躲一躲！';
    if (this.linked) return '默契连桥成功！护送小精灵跨过峡谷！';
    if (this.tailwind) return '景深彩虹顺风开启！小精灵加速过桥！';
    if (this.remainingMs > 40000) return '伸展双臂搭起彩虹桥，把小精灵送到云朵城堡！';
    if (this.remainingMs > 15000) return '星河冒险 · 注意摘取高空星星并躲避小雷云！';
    return '彩虹大游行 · 齐心协力护送双精灵！';
  }

  setRemainingMs(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.remainingMs = ms;
  }

  clearTrails(): void {
    this.lastDemoX = null;
    this.demoTilt = 0;
  }

  pointer(point: Point, fit: Rect): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || fit.width <= 0 || fit.height <= 0) return;
    const nx = clamp((point.x - fit.x) / fit.width, 0.04, 0.96);
    const ny = clamp((point.y - fit.y) / fit.height, 0.08, 0.92);
    if (this.lastDemoX !== null) {
      const dx = nx - this.lastDemoX;
      this.demoTilt = clamp(this.demoTilt * 0.65 + dx * 0.45, -0.06, 0.06);
    }
    this.lastDemoX = nx;
    this.demoPoint = { x: nx, y: ny };
    const half = this.gentle ? 0.17 : 0.14;
    const x1 = clamp(nx - half, 0.02, 0.96);
    const x2 = clamp(nx + half, 0.04, 0.98);
    const y1 = clamp(ny - this.demoTilt, 0.08, 0.92);
    const y2 = clamp(ny + this.demoTilt, 0.08, 0.92);
    this.segments = [{ x1, y1, x2, y2, cooperative: false, playerId: 1 }];
    this.linked = false;
    this.tailwind = false;
    this.evaluations = [{ id: 1, screenX: nx, screenY: ny, ducking: ny >= 0.6, depthMeters: null }];
  }

  observePlayers(players: TrackedPlayer[], _fit: Rect): void {
    this.demoPoint = null;
    const wasLinked = this.linked;
    const nextSegments: BridgeSegment[] = [];
    const evals: PlayerEval[] = [];
    const spans: Array<{ id: number; centerX: number; left: Point; right: Point }> = [];
    let anyTailwind = false;

    for (const player of players) {
      const shoulder = shoulderCenter(player);
      const sx = clamp(1 - shoulder.x, 0.04, 0.96);
      const sy = clamp(shoulder.y, 0.06, 0.92);
      const sw = clamp(player.shoulderWidth, 0.03, 0.55);
      const depth = typeof player.depthMeters === 'number' && Number.isFinite(player.depthMeters) ? player.depthMeters : null;
      let base = this.baselines.get(player.id);
      if (!base) {
        base = { shoulderY: sy, depthMeters: depth };
        this.baselines.set(player.id, base);
      } else {
        if (!this.cloud && sy < base.shoulderY + 0.04) {
          base.shoulderY = base.shoulderY * 0.96 + sy * 0.04;
        }
        if (depth !== null && !this.cloud) {
          base.depthMeters = base.depthMeters === null ? depth : base.depthMeters * 0.95 + depth * 0.05;
        }
      }

      if (depth !== null && base.depthMeters !== null && base.depthMeters - depth >= 0.16) {
        anyTailwind = true;
      }
      const ducking = sy - base.shoulderY >= (this.gentle ? 0.07 : 0.1) || sy >= (this.gentle ? 0.58 : 0.63);
      evals.push({ id: player.id, screenX: sx, screenY: sy, ducking, depthMeters: depth });

      const wristPts = player.wrists
        .filter((w): w is Point => w !== null && Number.isFinite(w.x) && Number.isFinite(w.y))
        .map(w => ({ x: clamp(1 - w.x, 0.02, 0.98), y: clamp(w.y, 0.06, 0.92) }));
      const minHalf = Math.max(0.08, sw * 0.65);
      const leftWrists = wristPts.filter(p => p.x <= sx).sort((a, b) => a.x - b.x);
      const rightWrists = wristPts.filter(p => p.x > sx).sort((a, b) => b.x - a.x);
      const midPt: Point = { x: sx, y: clamp(sy + 0.02, 0.06, 0.92) };
      const leftPt: Point = leftWrists.length > 0
        ? { x: clamp(Math.min(leftWrists[0].x, sx - minHalf), 0.02, 0.96), y: leftWrists[0].y }
        : { x: clamp(sx - minHalf, 0.02, 0.96), y: midPt.y };
      const rightPt: Point = rightWrists.length > 0
        ? { x: clamp(Math.max(rightWrists[0].x, sx + minHalf), 0.04, 0.98), y: rightWrists[0].y }
        : { x: clamp(sx + minHalf, 0.04, 0.98), y: midPt.y };

      nextSegments.push({ x1: leftPt.x, y1: leftPt.y, x2: midPt.x, y2: midPt.y, cooperative: false, playerId: player.id });
      nextSegments.push({ x1: midPt.x, y1: midPt.y, x2: rightPt.x, y2: rightPt.y, cooperative: false, playerId: player.id });
      spans.push({ id: player.id, centerX: sx, left: leftPt, right: rightPt });
    }

    let isLinked = false;
    if (spans.length === 2) {
      spans.sort((a, b) => a.centerX - b.centerX);
      const first = spans[0];
      const second = spans[1];
      const gap = second.left.x - first.right.x;
      const maxGap = this.gentle ? 0.3 : 0.24;
      if (gap >= -0.08 && gap <= maxGap) {
        const x1 = Math.min(first.right.x, second.left.x);
        const x2 = Math.max(first.right.x, second.left.x);
        const y1 = first.right.x <= second.left.x ? first.right.y : second.left.y;
        const y2 = first.right.x <= second.left.x ? second.left.y : first.right.y;
        nextSegments.push({ x1, y1, x2: Math.max(x1 + 0.01, x2), y2, cooperative: true, playerId: null });
        isLinked = true;
      }
    }

    this.segments = nextSegments;
    this.evaluations = evals;
    this.linked = isLinked;
    this.tailwind = anyTailwind;
    if (isLinked && !wasLinked) {
      this.onLinkChime();
    }
  }

  update(deltaMs: number, fit: Rect): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const dt = Math.min(deltaMs, 100);
    const sec = dt / 1000;
    this.elapsedMs += dt;
    this.updateEffects(dt);

    const wave = this.remainingMs > 40000 ? 1 : this.remainingMs > 15000 ? 2 : 3;
    const maxSprites = wave === 3 ? 2 : 1;
    if (this.sprites.length < maxSprites) {
      this.spriteCooldownMs -= dt;
      if (this.spriteCooldownMs <= 0) {
        this.spawnSprite();
        this.spriteCooldownMs = wave === 3 ? 2400 : 1200;
      }
    }

    if (!this.skyStar && this.remainingMs <= 54000) {
      this.starCooldownMs -= dt;
      if (this.starCooldownMs <= 0) {
        this.skyStar = {
          id: this.nextId++,
          x: 0.26 + this.random() * 0.48,
          y: 0.24 + this.random() * 0.24,
          age: 0,
        };
      }
    } else if (this.skyStar) {
      this.skyStar.age += dt;
    }

    if (this.remainingMs <= 42000) {
      if (!this.cloud) {
        this.cloudCooldownMs -= dt;
        if (this.cloudCooldownMs <= 0) {
          const totalMs = this.gentle ? 2800 : 2300;
          this.cloud = {
            id: this.nextId++,
            x: 0.28 + this.random() * 0.44,
            remainingMs: totalMs,
            totalMs,
          };
        }
      } else {
        this.cloud.remainingMs -= dt;
        if (this.cloud.remainingMs <= 0) {
          this.resolveCloud(fit);
        }
      }
    }

    this.advanceSprites(sec, fit);
    this.checkSkyStar(fit);
  }

  private spawnSprite(): void {
    this.spriteSpawnCount += 1;
    const golden = this.spriteSpawnCount % 3 === 0;
    this.sprites.push({
      id: this.nextId++,
      x: 0.08,
      y: 0.51,
      vy: 0,
      golden,
      falling: false,
      usedLink: false,
      bobPhase: this.random() * Math.PI * 2,
    });
  }

  private supportAt(x: number, y: number): { y: number; cooperative: boolean } | null {
    if (x <= 0.16) return { y: 0.54, cooperative: false };
    const margin = this.gentle ? 0.055 : 0.04;
    const above = 0.18;
    const below = 0.1;
    let best: { y: number; cooperative: boolean } | null = null;
    for (const seg of this.segments) {
      const lo = Math.min(seg.x1, seg.x2) - margin;
      const hi = Math.max(seg.x1, seg.x2) + margin;
      if (x < lo || x > hi) continue;
      const span = seg.x2 - seg.x1;
      const t = Math.abs(span) > 1e-4 ? clamp((x - seg.x1) / span, 0, 1) : 0.5;
      const segY = seg.y1 + (seg.y2 - seg.y1) * t;
      if (y < segY - above || y > segY + below) continue;
      if (!best || segY < best.y) {
        best = { y: segY, cooperative: seg.cooperative };
      }
    }
    return best;
  }

  private advanceSprites(sec: number, fit: Rect): void {
    const baseSpeed = (this.gentle ? 0.115 : 0.145) * (this.tailwind ? 1.45 : 1);
    const fallSpeed = this.gentle ? 0.155 : 0.21;
    const remaining: Sprite[] = [];

    for (const sprite of this.sprites) {
      sprite.bobPhase += sec * 5;
      if (sprite.x >= 0.85 && sprite.y <= 0.88) {
        this.escortedCount += 1;
        const points = (sprite.golden ? 60 : 40) + (sprite.usedLink ? 10 : 0);
        const label = sprite.usedLink ? '默契连桥护送 +' + points + '！' : '护送成功 +' + points + '！';
        this.banner = { text: label, color: sprite.golden ? '#d48d1d' : '#2f8f72', age: 0, life: 1400 };
        this.emitParticles(fit.x + fit.width * 0.9, fit.y + fit.height * 0.5, sprite.golden ? '#f6c858' : '#58c7a3', 24);
        this.onEvent({ id: sprite.id, kind: 'escort', points, golden: sprite.golden, linked: sprite.usedLink });
        continue;
      }

      const support = this.supportAt(sprite.x, sprite.y);
      if (support) {
        const targetY = support.y - 0.03;
        sprite.y += (targetY - sprite.y) * Math.min(1, sec * 14);
        sprite.vy = 0;
        sprite.falling = false;
        sprite.x += baseSpeed * sec;
        if (support.cooperative) sprite.usedLink = true;
      } else {
        sprite.falling = true;
        sprite.vy = fallSpeed;
        sprite.y += sprite.vy * sec;
        sprite.x = clamp(sprite.x + Math.sin(sprite.bobPhase) * 0.02 * sec, 0.06, 0.94);
        if (sprite.y > 0.94) {
          this.missedCount += 1;
          this.banner = { text: '小精灵乘泡泡飘走啦，快接下一只！', color: '#c45b68', age: 0, life: 1200 };
          this.emitParticles(fit.x + sprite.x * fit.width, fit.y + fit.height * 0.9, '#eb8a7e', 10);
          this.onEvent({ id: sprite.id, kind: 'missed', points: 0 });
          continue;
        }
      }
      remaining.push(sprite);
    }
    this.sprites = remaining;
  }

  private checkSkyStar(fit: Rect): void {
    if (!this.skyStar) return;
    const star = this.skyStar;
    const radius = this.gentle ? 0.085 : 0.068;
    let hit = this.sprites.some(sprite => Math.hypot(sprite.x - star.x, sprite.y - star.y) <= radius);
    if (!hit) {
      hit = this.segments.some(seg => intersectsSweep({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, { x: star.x, y: star.y, radius }));
    }
    if (hit) {
      this.skyStar = null;
      this.starCooldownMs = 5200;
      this.starsCount += 1;
      this.banner = { text: '摘到高空星星 +20！', color: '#d48d1d', age: 0, life: 1300 };
      this.emitParticles(fit.x + star.x * fit.width, fit.y + star.y * fit.height, '#f6c858', 20);
      this.onEvent({ id: star.id, kind: 'star', points: 20 });
    }
  }

  private resolveCloud(fit: Rect): void {
    const current = this.cloud!;
    this.cloud = null;
    this.cloudCooldownMs = this.gentle ? 10500 : 9000;
    const allDucking = this.evaluations.length > 0 && this.evaluations.every(item => item.ducking);
    if (allDucking) {
      this.dodgedCount += 1;
      this.flash = { x: current.x, kind: 'dodge', age: 0, life: 500 };
      this.banner = { text: '全员下蹲躲雷 +30！', color: '#2f8f72', age: 0, life: 1400 };
      this.emitParticles(fit.x + current.x * fit.width, fit.y + fit.height * 0.2, '#58c7a3', 20);
      this.onEvent({ id: current.id, kind: 'dodge', points: 30 });
    } else {
      this.flash = { x: current.x, kind: 'zap', age: 0, life: 500 };
      this.banner = { text: '被小雷云挠痒痒啦，下次一起蹲低！', color: '#c45b68', age: 0, life: 1300 };
      this.emitParticles(fit.x + current.x * fit.width, fit.y + fit.height * 0.25, '#f28b82', 14);
      this.onEvent({ id: current.id, kind: 'zapped', points: 0 });
    }
  }

  private emitParticles(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + this.random() * 0.35;
      const speed = 80 + this.random() * 170;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        radius: 5 + this.random() * 5,
        color,
        age: 0,
        life: 650 + this.random() * 320,
      });
    }
  }

  private updateEffects(dt: number): void {
    const sec = dt / 1000;
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * sec;
      p.y += p.vy * sec;
      p.vy += 240 * sec;
    }
    this.particles = this.particles.filter(p => p.age < p.life);
    if (this.banner) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.life) this.banner = null;
    }
    if (this.flash) {
      this.flash.age += dt;
      if (this.flash.age >= this.flash.life) this.flash = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, fit: Rect): void {
    if (fit.width <= 0 || fit.height <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.x, fit.y, fit.width, fit.height);
    ctx.clip();
    this.drawCanyonLandmarks(ctx, fit);
    this.drawBridges(ctx, fit);
    if (this.skyStar) this.drawSkyStar(ctx, fit, this.skyStar);
    for (const sprite of this.sprites) this.drawSprite(ctx, fit, sprite);
    if (this.cloud) this.drawCloud(ctx, fit, this.cloud);
    if (this.flash) this.drawFlash(ctx, fit, this.flash);
    if (this.cloud) this.drawDuckBadges(ctx, fit);
    this.drawTopStatus(ctx, fit);
    this.drawParticles(ctx);
    if (this.banner) this.drawBanner(ctx, fit, this.banner);
    ctx.restore();
  }

  private drawCanyonLandmarks(ctx: CanvasRenderingContext2D, fit: Rect): void {
    const leftW = fit.width * 0.15;
    const cliffY = fit.y + fit.height * 0.54;
    const cliffH = fit.y + fit.height - cliffY;
    ctx.fillStyle = 'rgba(130, 198, 173, 0.34)';
    drawRoundedRect(ctx, fit.x - 10, cliffY, leftW + 10, cliffH + 10, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(72, 166, 134, 0.72)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(fit.x, cliffY);
    ctx.lineTo(fit.x + leftW, cliffY);
    ctx.stroke();
    ctx.fillStyle = '#2d6c56';
    ctx.font = '800 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('星光起点', fit.x + leftW * 0.5, cliffY + 24);

    const rightX = fit.x + fit.width * 0.85;
    const rightW = fit.width * 0.15;
    ctx.fillStyle = 'rgba(166, 146, 224, 0.34)';
    drawRoundedRect(ctx, rightX, cliffY, rightW + 10, cliffH + 10, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(128, 102, 198, 0.75)';
    ctx.beginPath();
    ctx.moveTo(rightX, cliffY);
    ctx.lineTo(rightX + rightW, cliffY);
    ctx.stroke();

    const towerX = rightX + rightW * 0.5;
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = '#977ed1';
    ctx.lineWidth = 3;
    drawRoundedRect(ctx, towerX - 28, cliffY - 56, 56, 56, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f28b82';
    ctx.beginPath();
    ctx.moveTo(towerX - 34, cliffY - 54);
    ctx.lineTo(towerX, cliffY - 92);
    ctx.lineTo(towerX + 34, cliffY - 54);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#533c84';
    ctx.fillText('云朵城堡', towerX, cliffY + 24);
  }

  private drawBridges(ctx: CanvasRenderingContext2D, fit: Rect): void {
    const pulse = 1 + Math.sin(this.elapsedMs * 0.009) * 0.15;
    for (const seg of this.segments) {
      const x1 = fit.x + seg.x1 * fit.width;
      const y1 = fit.y + seg.y1 * fit.height;
      const x2 = fit.x + seg.x2 * fit.width;
      const y2 = fit.y + seg.y2 * fit.height;
      if (seg.cooperative) {
        ctx.strokeStyle = 'rgba(246, 200, 88, 0.45)';
        ctx.lineWidth = 26 * pulse;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
      for (let i = 0; i < RAINBOW_BANDS.length; i += 1) {
        const offset = (i - 1.5) * 4.5;
        ctx.strokeStyle = RAINBOW_BANDS[i];
        ctx.lineWidth = seg.cooperative ? 6 : 5;
        ctx.beginPath();
        ctx.moveTo(x1, y1 + offset);
        ctx.lineTo(x2, y2 + offset);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = seg.cooperative ? '#f6c858' : '#7c65b8';
      ctx.lineWidth = 3;
      for (const [px, py] of [[x1, y1], [x2, y2]]) {
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  private drawSprite(ctx: CanvasRenderingContext2D, fit: Rect, sprite: Sprite): void {
    const sx = fit.x + sprite.x * fit.width;
    const sy = fit.y + sprite.y * fit.height;
    const r = Math.max(18, fit.width * 0.022);

    if (sprite.falling) {
      ctx.strokeStyle = 'rgba(130, 175, 235, 0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx - r * 0.85, sy - r * 1.15);
      ctx.lineTo(sx - r * 0.35, sy - r * 0.3);
      ctx.moveTo(sx + r * 0.85, sy - r * 1.15);
      ctx.lineTo(sx + r * 0.35, sy - r * 0.3);
      ctx.stroke();
      ctx.fillStyle = 'rgba(202, 228, 255, 0.72)';
      ctx.beginPath();
      ctx.arc(sx, sy - r * 1.15, r * 1.05, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = sprite.golden ? 'rgba(246, 200, 88, 0.32)' : 'rgba(126, 208, 180, 0.32)';
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = sprite.golden ? '#f6c858' : '#65c9a8';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (sprite.golden) {
      ctx.fillStyle = '#ffe58f';
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - r + 2);
      ctx.lineTo(sx - 6, sy - r - 9);
      ctx.lineTo(sx, sy - r - 2);
      ctx.lineTo(sx + 6, sy - r - 9);
      ctx.lineTo(sx + 10, sy - r + 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#2d243b';
    ctx.beginPath();
    ctx.arc(sx - r * 0.28, sy - r * 0.1, 2.5, 0, Math.PI * 2);
    ctx.arc(sx + r * 0.28, sy - r * 0.1, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSkyStar(ctx: CanvasRenderingContext2D, fit: Rect, star: SkyStar): void {
    const sx = fit.x + star.x * fit.width;
    const sy = fit.y + star.y * fit.height + Math.sin(star.age * 0.005) * 6;
    const r = Math.max(20, fit.width * 0.025);
    ctx.fillStyle = 'rgba(246, 200, 88, 0.28)';
    ctx.beginPath();
    ctx.arc(sx, sy, r * 1.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6c858';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    drawStarShape(ctx, sx, sy, r, r * 0.46);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6c490e';
    ctx.font = '800 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+20', sx, sy + 1);
  }

  private drawCloud(ctx: CanvasRenderingContext2D, fit: Rect, cloud: ThunderCloud): void {
    const cx = fit.x + cloud.x * fit.width;
    const cy = fit.y + fit.height * 0.16;
    const ratio = clamp(1 - cloud.remainingMs / cloud.totalMs, 0, 1);
    ctx.fillStyle = 'rgba(98, 92, 134, 0.9)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 62, 26, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - 32, cy - 10, 32, 22, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 30, cy - 8, 34, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6c858';
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy + 16);
    ctx.lineTo(cx - 10, cy + 42);
    ctx.lineTo(cx + 2, cy + 42);
    ctx.lineTo(cx - 6, cy + 64);
    ctx.lineTo(cx + 16, cy + 34);
    ctx.lineTo(cx + 4, cy + 34);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('雷云来啦！快下蹲！', cx, cy - 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    drawRoundedRect(ctx, cx - 44, cy + 10, 88, 6, 3);
    ctx.fill();
    ctx.fillStyle = '#f6c858';
    drawRoundedRect(ctx, cx - 44, cy + 10, 88 * ratio, 6, 3);
    ctx.fill();
  }

  private drawFlash(ctx: CanvasRenderingContext2D, fit: Rect, flash: CloudFlash): void {
    const alpha = Math.max(0, 1 - flash.age / flash.life) * 0.25;
    ctx.fillStyle = flash.kind === 'dodge' ? `rgba(88, 199, 163, ${alpha})` : `rgba(242, 139, 130, ${alpha})`;
    ctx.fillRect(fit.x, fit.y, fit.width, fit.height);
  }

  private drawDuckBadges(ctx: CanvasRenderingContext2D, fit: Rect): void {
    for (const item of this.evaluations) {
      const px = fit.x + item.screenX * fit.width;
      const py = fit.y + clamp(item.screenY - 0.1, 0.1, 0.85) * fit.height;
      ctx.fillStyle = item.ducking ? 'rgba(57, 185, 141, 0.92)' : 'rgba(239, 131, 111, 0.92)';
      drawRoundedRect(ctx, px - 42, py - 14, 84, 28, 14);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '750 13px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.ducking ? '已蹲好' : '快下蹲', px, py);
    }
  }

  private drawTopStatus(ctx: CanvasRenderingContext2D, fit: Rect): void {
    if (!this.linked && !this.tailwind) return;
    const text = this.linked && this.tailwind ? '默契连桥 + 景深顺风！' : this.linked ? '默契连桥已接通！' : '景深彩虹顺风加速！';
    const pillW = 240;
    const pillH = 38;
    const px = fit.x + (fit.width - pillW) / 2;
    const py = fit.y + 16;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    drawRoundedRect(ctx, px, py, pillW, pillH, 19);
    ctx.fill();
    ctx.strokeStyle = this.linked ? '#f6c858' : '#4da8d8';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#3b2d54';
    ctx.font = '800 15px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + pillW / 2, py + pillH / 2);
  }

  private drawBanner(ctx: CanvasRenderingContext2D, fit: Rect, banner: Banner): void {
    const t = banner.age / banner.life;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const bw = 340;
    const bh = 52;
    const bx = fit.x + (fit.width - bw) / 2;
    const by = fit.y + fit.height * 0.24 - t * 24;
    ctx.fillStyle = banner.color;
    drawRoundedRect(ctx, bx, by, bw, bh, 26);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 21px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, bx + bw / 2, by + bh / 2);
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = p.color;
      drawStarShape(ctx, p.x, p.y, p.radius, p.radius * 0.45);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
