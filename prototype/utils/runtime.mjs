export function createFrameClock(onFrame) {
  let frame = 0;
  let previous = 0;
  let running = false;
  function step(now) {
    if (!running) return;
    const delta = previous ? Math.max(0, now - previous) : 0;
    previous = now;
    onFrame(delta);
    if (running) frame = requestAnimationFrame(step);
  }
  return {
    start() {
      if (running) return;
      running = true;
      previous = 0;
      frame = requestAnimationFrame(step);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      previous = 0;
    }
  };
}

export function createSound() {
  let context;
  let enabled = true;
  let usable = true;
  async function unlock() {
    if (!enabled || !usable) return false;
    try {
      context ??= new AudioContext();
      if (context.state === 'suspended') await context.resume();
      return context.state === 'running';
    } catch {
      usable = false;
      return false;
    }
  }
  function play(frequency = 600) {
    if (!enabled || context?.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, now + 0.08);
    gain.gain.setValueAtTime(0.075, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  return { unlock, play, toggle() { enabled = !enabled; return enabled; }, get enabled() { return enabled; } };
}

export async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await document.documentElement.requestFullscreen();
  }
}
