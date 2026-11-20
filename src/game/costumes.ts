export type FaceKind = 'soot' | 'donkey' | 'piglet';
export type FaceEffect = { kind: FaceKind; alpha: number; elapsedMs: number };
type Entry = { kind: FaceKind; remainingMs: number };

const kinds: readonly FaceKind[] = ['soot', 'donkey', 'piglet'];
export const faceNames: Readonly<Record<FaceKind, string>> = { soot: '小黑脸', donkey: '小驴脸', piglet: '小猪脸' };

export class FaceEffects {
  private entries = new Map<number, Entry>();

  trigger(playerId: number, roll: number): FaceKind {
    const index = Number.isFinite(roll) ? Math.floor(Math.max(0, Math.min(1 - Number.EPSILON, roll)) * kinds.length) : 0;
    const kind = kinds[index];
    if (Number.isFinite(playerId)) this.entries.set(playerId, { kind, remainingMs: 4500 });
    return kind;
  }

  advance(delta: number): void {
    if (!Number.isFinite(delta) || delta <= 0) return;
    for (const [id, entry] of this.entries) {
      entry.remainingMs -= delta;
      if (entry.remainingMs <= 0) this.entries.delete(id);
    }
  }

  get(playerId: number): FaceEffect | null {
    const entry = this.entries.get(playerId);
    return entry ? { kind: entry.kind, alpha: Math.min(1, entry.remainingMs / 1200), elapsedMs: 4500 - entry.remainingMs } : null;
  }

  prune(ids: ReadonlySet<number>): void {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }
}
