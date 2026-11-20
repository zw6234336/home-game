import type { Point, TrackedPlayer, VisionFrame } from '../types.ts';
import { DwellController } from '../interaction/dwell.ts';
import { validLandmark } from '../interaction/geometry.ts';
import { menuPoint } from '../interaction/menu-point.ts';

type NavigationEvent = (code: string, reason: string) => void;

function nearButton(button: HTMLButtonElement, point: Point, margin = 18): boolean {
  const rect = button.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && point.x >= rect.left - margin && point.x <= rect.right + margin && point.y >= rect.top - margin && point.y <= rect.bottom + margin;
}

export class GestureNavigation {
  private dwell = new DwellController(1000);
  private owner = '';
  private target: HTMLButtonElement | null = null;
  private cursor = document.querySelector<HTMLElement>('#gesture-cursor')!;
  private point: Point | null = null;
  private awaitingLower = false;
  private progress = 0;
  private onEvent?: NavigationEvent;
  constructor(onEvent?: NavigationEvent) {
    this.onEvent = onEvent;
  }
  reset() {
    this.dwell.reset(); this.owner = ''; this.point = null; this.awaitingLower = false; this.progress = 0;
    if (this.target) delete this.target.dataset.dwell;
    this.target = null; this.cursor.style.display = 'none';
  }
  suspend() {
    if (this.target) delete this.target.dataset.dwell;
    this.cursor.style.display = 'none';
  }
  update(players: TrackedPlayer[], frame: VisionFrame, now: number, actions?: readonly string[], aspectRatio = 1) {
    if (now - frame.capturedAt > 150 || now < frame.capturedAt) {
      if (this.progress > 0.05) this.onEvent?.('gesture_dwell_reset', 'stale_frame');
      this.progress = 0;
      this.suspend();
      return;
    }
    const options = players.flatMap(player => player.wrists.flatMap((wrist, side) => {
      const shoulder = player.landmarks[11 + side];
      if (!wrist || !validLandmark(shoulder)) return [];
      const key = player.id + '/' + side;
      const entryLine = shoulder.y - Math.max(0.03, player.shoulderWidth * 0.15);
      const keepLine = !this.awaitingLower && this.owner === key ? shoulder.y + Math.max(0.05, player.shoulderWidth * 0.25) : entryLine;
      return wrist.y < keepLine ? [{ player, wrist, side, key }] : [];
    }));
    options.sort((a, b) => a.wrist.y - b.wrist.y);
    const choice = options.find(option => option.key === this.owner) ?? options[0];
    if (!choice) {
      if (this.progress > 0.05) this.onEvent?.('gesture_dwell_reset', 'hand_lowered');
      this.reset();
      return;
    }
    if (this.awaitingLower) { this.suspend(); return; }
    if (this.owner !== choice.key) {
      if (this.progress > 0.05) this.onEvent?.('gesture_dwell_reset', 'owner_changed');
      this.dwell.reset(); this.point = null; this.progress = 0; this.owner = choice.key;
    }
    const projected = menuPoint(choice.player, choice.wrist, aspectRatio);
    if (!projected) {
      if (this.progress > 0.05) this.onEvent?.('gesture_dwell_reset', 'menu_point_null');
      this.reset();
      return;
    }
    const next = { x: projected.x * innerWidth, y: projected.y * innerHeight };
    if (!this.point) this.point = next;
    else {
      const step = Math.hypot(next.x - this.point.x, next.y - this.point.y);
      if (!this.target || step >= 4) {
        const alpha = step > 36 ? 0.45 : this.target ? 0.18 : 0.28;
        this.point = { x: this.point.x + (next.x - this.point.x) * alpha, y: this.point.y + (next.y - this.point.y) * alpha };
      }
    }
    const modal = document.querySelector<HTMLDialogElement>('dialog[open]');
    const parent = modal ?? document.body;
    if (this.cursor.parentElement !== parent) parent.append(this.cursor);
    this.cursor.style.display = 'block'; this.cursor.style.left = this.point.x + 'px'; this.cursor.style.top = this.point.y + 'px';
    const eligible = (button: HTMLButtonElement | null) => button && button.isConnected && !button.disabled && (!modal || modal.contains(button)) && (!actions || actions.includes(button.dataset.action ?? '')) ? button : null;
    const direct = eligible(document.elementFromPoint(this.point.x, this.point.y)?.closest<HTMLButtonElement>('button[data-action]') ?? null);
    const sticky = !direct && this.target && eligible(this.target) && nearButton(this.target, this.point) ? this.target : null;
    const target = direct ?? sticky;
    if (this.target !== target) {
      if (this.progress > 0.05) this.onEvent?.('gesture_dwell_reset', target ? 'target_changed' : 'cursor_left_target');
      if (this.target) delete this.target.dataset.dwell;
      this.target = target;
    }
    const result = this.dwell.update({ time: frame.capturedAt, target: target?.dataset.gestureId ?? null, eligible: !!target });
    if (this.progress > 0.05 && result.progress === 0 && !result.activated && target) this.onEvent?.('gesture_dwell_reset', 'frame_gap');
    this.progress = result.progress;
    this.cursor.style.setProperty('--progress', result.progress * 360 + 'deg');
    if (target) target.dataset.dwell = 'true';
    if (result.activated && target?.isConnected) {
      this.onEvent?.('gesture_activate', target.dataset.action ?? 'button');
      this.progress = 0;
      target.click();
      this.awaitingLower = true;
    }
  }
}
