export type AnomalyEntry = { atMs: number; code: string; page: string; reason: string };
export type AnomalySnapshot = { total: number; counts: Record<string, number>; recent: AnomalyEntry[] };

const labels: Record<string, string> = {
  stale_frame: '过期帧丢弃',
  calibration_soft_scale_jitter: '肩宽瞬时抖动',
  calibration_soft_motion_jitter: '肩位瞬时抖动',
  calibration_hard_jump: '位置或尺度大跳变',
  calibration_timeout_500ms: '超500ms未恢复校准',
  calibration_id_replaced: '追踪身份重建',
  calibration_not_separated: '双人重叠',
  tracking_lost: '游玩中失配',
  auto_pause: '自动暂停',
  gesture_dwell_reset: '手势确认中断',
  gesture_activate: '手势确认成功',
  vision_error: '视觉异常',
  camera_ended: '摄像头断开',
};

export class AnomalyLog {
  private origin: number | null = null;
  private total = 0;
  private counts = new Map<string, number>();
  private recent: AnomalyEntry[] = [];
  private lastByKey = new Map<string, number>();
  private readonly limit: number;
  private readonly throttleMs: number;

  constructor(limit = 16, throttleMs = 500) {
    this.limit = limit;
    this.throttleMs = throttleMs;
  }

  record(code: string, reason: string, page: string, now: number): void {
    if (!code || !Number.isFinite(now)) return;
    if (this.origin === null || now < this.origin) this.origin = now;
    const key = reason ? code + ':' + reason : code;
    this.total += 1;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const previous = this.lastByKey.get(key);
    if (previous !== undefined && now - previous < this.throttleMs) return;
    this.lastByKey.set(key, now);
    this.recent.push({ atMs: Math.round(Math.max(0, now - this.origin)), code, page, reason });
    if (this.recent.length > this.limit) this.recent.shift();
  }

  snapshot(): AnomalySnapshot {
    const sorted = [...this.counts.entries()].sort((first, second) => second[1] - first[1]).slice(0, 12);
    return { total: this.total, counts: Object.fromEntries(sorted), recent: this.recent.map(entry => ({ ...entry })) };
  }

  summary(): string {
    if (!this.total) return '暂无异常记录';
    const top = [...this.counts.entries()].sort((first, second) => second[1] - first[1]).slice(0, 3);
    return '异常记录：' + top.map(([key, count]) => {
      const [code, reason] = key.split(':');
      const name = labels[code + '_' + reason] ?? labels[code] ?? key;
      return name + ' ×' + count;
    }).join(' · ');
  }

  reset(): void {
    this.origin = null;
    this.total = 0;
    this.counts.clear();
    this.recent = [];
    this.lastByKey.clear();
  }
}
