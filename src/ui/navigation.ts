import type { Point, TrackedPlayer, VisionFrame } from '../types.ts';
import { DwellController } from '../interaction/dwell.ts';
import { validLandmark } from '../interaction/geometry.ts';
import { menuPoint } from '../interaction/menu-point.ts';

export class GestureNavigation {
  private dwell = new DwellController(1000);
  private owner = '';
  private target: HTMLElement | null = null;
  private cursor = document.querySelector<HTMLElement>('#gesture-cursor')!;
  private point: Point | null = null;
  private awaitingLower = false;
  reset() {
    this.dwell.reset(); this.owner = ''; this.point = null; this.awaitingLower = false;
    if (this.target) delete this.target.dataset.dwell;
    this.target = null; this.cursor.style.display = 'none';
  }
  suspend() {
    if (this.target) delete this.target.dataset.dwell;
    this.cursor.style.display = 'none';
  }
  update(players: TrackedPlayer[], frame: VisionFrame, now: number, actions?: readonly string[], aspectRatio = 1) {
    if (now - frame.capturedAt > 150 || now < frame.capturedAt) { this.suspend(); return; }
    const options = players.flatMap(player => player.wrists.flatMap((wrist, side) => wrist && validLandmark(player.landmarks[11 + side]) && wrist.y < player.landmarks[11 + side].y - Math.max(0.03, player.shoulderWidth * 0.15) ? [{ player, wrist, side }] : []));
    options.sort((a, b) => a.wrist.y - b.wrist.y);
    const choice = options.find(option => option.player.id + '/' + option.side === this.owner) ?? options[0];
    if (!choice) { this.reset(); return; }
    if (this.awaitingLower) { this.suspend(); return; }
    const owner = choice.player.id + '/' + choice.side;
    if (this.owner !== owner) { this.dwell.reset(); this.point = null; this.owner = owner; }
    let hand = choice.wrist;
    if (now - frame.handsCapturedAt <= 150) {
      const fine = frame.hands.find(item => validLandmark(item.landmarks[0]) && Math.hypot(item.landmarks[0].x - hand.x, item.landmarks[0].y - hand.y) < 0.12);
      if (fine) hand = fine.landmarks[0];
    }
    const projected = menuPoint(choice.player, hand, aspectRatio);
    if (!projected) { this.reset(); return; }
    const next = { x: projected.x * innerWidth, y: projected.y * innerHeight };
    this.point = this.point ? { x: this.point.x * 0.25 + next.x * 0.75, y: this.point.y * 0.25 + next.y * 0.75 } : next;
    const modal = document.querySelector<HTMLDialogElement>('dialog[open]');
    const parent = modal ?? document.body;
    if (this.cursor.parentElement !== parent) parent.append(this.cursor);
    this.cursor.style.display = 'block'; this.cursor.style.left = this.point.x + 'px'; this.cursor.style.top = this.point.y + 'px';
    const element = document.elementFromPoint(this.point.x, this.point.y)?.closest<HTMLButtonElement>('button[data-action]') ?? null;
    const target = element && !element.disabled && (!modal || modal.contains(element)) && (!actions || actions.includes(element.dataset.action ?? '')) ? element : null;
    if (this.target !== target) { if (this.target) delete this.target.dataset.dwell; this.target = target; }
    const result = this.dwell.update({ time: frame.capturedAt, target: target?.dataset.gestureId ?? null, eligible: !!target });
    this.cursor.style.setProperty('--progress', result.progress * 360 + 'deg');
    if (target) target.dataset.dwell = 'true';
    if (result.activated && target?.isConnected) { target.click(); this.awaitingLower = true; }
  }
}
