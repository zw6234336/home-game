type VisualSnapshot = { paused: boolean; score: number | null; countdown: number };

export class VisualMotion {
  private animations = new Map<Element, Animation>();
  private preference = matchMedia('(prefers-reduced-motion: reduce)');
  private score: number | null = null;
  private countdown = 0;
  private paused = false;

  constructor() {
    this.preference.addEventListener('change', () => {
      if (this.preference.matches) this.clear();
    });
  }

  clear(): void {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    this.score = null;
    this.countdown = 0;
  }

  suspend(): void {
    this.paused = true;
    document.documentElement.dataset.visualPaused = 'true';
    for (const animation of this.animations.values()) animation.pause();
  }

  private animate(element: Element | null, frames: Keyframe[], duration: number): void {
    if (!element || this.preference.matches || this.paused) return;
    this.animations.get(element)?.cancel();
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.3,1)' });
    this.animations.set(element, animation);
    animation.onfinish = () => { if (this.animations.get(element) === animation) this.animations.delete(element); };
  }

  sync(root: HTMLElement, snapshot: VisualSnapshot): void {
    const stopped = snapshot.paused || document.hidden;
    if (this.paused !== stopped) {
      this.paused = stopped;
      document.documentElement.dataset.visualPaused = String(stopped);
      for (const animation of this.animations.values()) {
        if (stopped) animation.pause();
        else animation.play();
      }
    }
    if (snapshot.score !== null && this.score !== null && snapshot.score > this.score) {
      this.animate(root.querySelector('#score'), [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', color: '#aa5b3e', offset: .35 }, { transform: 'scale(1)' }], 420);
      root.querySelectorAll('.visual-reward i').forEach((element, index) => {
        const angle = index * Math.PI / 4;
        const x = Math.round(Math.cos(angle) * (64 + index * 6));
        const y = Math.round(Math.sin(angle) * 56 - 36);
        this.animate(element, [{ opacity: 0, transform: 'translate(0, 0) scale(.3)' }, { opacity: .85, offset: .18 }, { opacity: 0, transform: 'translate(' + x + 'px, ' + y + 'px) rotate(100deg) scale(.5)' }], 720);
      });
    }
    if (snapshot.countdown > 0 && snapshot.countdown !== this.countdown) {
      this.animate(root.querySelector('#countdown-number'), [{ opacity: .3, transform: 'scale(.78)' }, { opacity: 1, transform: 'scale(1.06)', offset: .65 }, { opacity: 1, transform: 'scale(1)' }], 420);
    }
    this.score = snapshot.score;
    this.countdown = snapshot.countdown;
  }
}
