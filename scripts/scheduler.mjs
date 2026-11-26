export function delayMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function startManagedInterval(task, intervalMs) {
  const timer = setInterval(task, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
