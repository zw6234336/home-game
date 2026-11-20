export function frameLoop(onFrame: (now: number, delta: number) => void) {
  let handle = 0;
  let last = 0;
  let active = false;
  function step(now: number) {
    if (!active) return;
    const delta = last ? Math.max(0, now - last) : 0;
    last = now;
    onFrame(now, delta);
    if (active) handle = requestAnimationFrame(step);
  }
  return {
    start() { if (!active) { active = true; last = 0; handle = requestAnimationFrame(step); } },
    stop() { active = false; cancelAnimationFrame(handle); last = 0; }
  };
}

export class Sound {
  enabled = true;
  private context: AudioContext | null = null;
  async unlock() {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      await this.context.resume();
    } catch { this.context = null; }
  }
  pop(combo: number) {
    if (!this.enabled || this.context?.state !== 'running') return;
    const ctx = this.context;
    const note = ctx.createOscillator();
    const volume = ctx.createGain();
    const start = ctx.currentTime;
    note.frequency.setValueAtTime(480 + Math.min(combo, 12) * 32, start);
    note.frequency.exponentialRampToValueAtTime(900 + Math.min(combo, 12) * 24, start + 0.08);
    volume.gain.setValueAtTime(0.055, start);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    note.connect(volume).connect(ctx.destination);
    note.start(start);
    note.stop(start + 0.19);
    note.onended = () => { note.disconnect(); volume.disconnect(); };
  }
  close() { void this.context?.close(); this.context = null; }
}

export function downloadDiagnostics(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'home-game-diagnostics.json';
  link.click();
  URL.revokeObjectURL(url);
}
