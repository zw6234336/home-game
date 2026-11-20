export class Metrics {
  private start = 0;
  private rendered = 0;
  private inferred = 0;
  private durations: number[] = [];
  private ages: number[] = [];
  render(now: number) { this.start ||= now; this.rendered++; }
  inference(duration: number, age: number) {
    this.inferred++;
    this.durations.push(duration);
    this.ages.push(age);
    if (this.durations.length > 600) { this.durations.shift(); this.ages.shift(); }
  }
  snapshot(now: number) {
    const seconds = Math.max(1, (now - this.start) / 1000);
    const percentile = (values: number[], p: number) => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
      return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0);
    };
    return { renderFps: Math.round(this.rendered / seconds), poseFps: Math.round(this.inferred / seconds), inferenceP50: percentile(this.durations, 0.5), inferenceP95: percentile(this.durations, 0.95), frameAgeP95: percentile(this.ages, 0.95), samples: this.durations.length, physicalLatency: '未测量；上述耗时不是动作到电视的端到端延迟' };
  }
  reset() { this.start = 0; this.rendered = 0; this.inferred = 0; this.durations = []; this.ages = []; }
}
