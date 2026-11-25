import type { TrackedPlayer, VisionFrame } from '../types.ts';
import { BodyMenuController, type BodyMenuAction } from '../interaction/body-menu.ts';
import { renderMarkup } from '../platform/dom.mjs';

type BodyMenuScope = { context: string; primary: string; aspect: number; duo?: boolean; missing?: boolean; binding?: string; members?: string };
const labels: Record<BodyMenuAction, string> = { previous: '上一项', next: '下一项', confirm: '确认', back: '返回' };

export class BodyMenuNavigation {
  private controller = new BodyMenuController();
  private focus: HTMLButtonElement | null = null;
  private panel = document.createElement('div');
  private revision = 0;
  private back: () => void;

  constructor(back: () => void) {
    this.back = back;
    this.panel.className = 'motion-menu';
    this.panel.hidden = true;
    renderMarkup(this.panel, '<div class="motion-menu-top"><span class="motion-menu-dot" aria-hidden="true"></span><b id="motion-menu-status">体感菜单</b><span id="motion-menu-action">先放松双手</span></div><progress id="motion-menu-progress" max="1" value="0" aria-label="体感动作保持进度"></progress><div class="motion-menu-legend"><span><svg viewBox="0 0 30 26" aria-hidden="true"><circle cx="15" cy="5" r="3"/><path d="M15 10v12M4 13h22M4 13l4-3M26 13l-4-3"/></svg>侧伸手臂切换</span><span><svg viewBox="0 0 30 26" aria-hidden="true"><circle cx="15" cy="5" r="3"/><path d="M15 10v12M7 19l4-7 4 4 4-4 4 7"/></svg>胸前合掌确认</span><span><svg viewBox="0 0 30 26" aria-hidden="true"><circle cx="15" cy="5" r="3"/><path d="M15 10v12M7 19l13-8M23 19l-13-8"/></svg>交叉搭肩返回</span></div>');
  }

  reset(): void {
    this.controller.reset(); this.revision++;
    if (this.focus) delete this.focus.dataset.motionFocus;
    this.focus = null;
  }

  hide(): void {
    this.panel.hidden = true;
    this.reset();
  }

  suspend(): void {
    this.controller.reset();
    if (!this.panel.hidden) {
      this.panel.querySelector<HTMLProgressElement>('progress')!.value = 0;
      this.panel.querySelector('#motion-menu-action')!.textContent = '请让双肩和小手入镜';
    }
  }

  private select(button: HTMLButtonElement | null): void {
    if (this.focus === button) return;
    if (this.focus) delete this.focus.dataset.motionFocus;
    this.focus = button;
    if (button) {
      button.dataset.motionFocus = 'true';
      const rect = button.getBoundingClientRect();
      const guide = this.panel.getBoundingClientRect();
      const overlapsGuide = !this.panel.hidden && rect.right > guide.left && rect.left < guide.right && rect.bottom > guide.top && rect.top < guide.bottom;
      if (rect.top < 0 || rect.bottom > innerHeight - 110 || overlapsGuide) button.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }

  update(players: TrackedPlayer[], frame: VisionFrame, now: number, scope: BodyMenuScope): boolean {
    const modal = document.querySelector<HTMLDialogElement>('dialog[open]');
    const root = modal ?? document.querySelector<HTMLElement>('#main')!;
    const parent = modal ?? document.body;
    if (this.panel.parentElement !== parent) parent.append(this.panel);
    this.panel.hidden = false;
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[data-action]')].filter(button => {
      const rect = button.getBoundingClientRect();
      return button.isConnected && !button.disabled && !button.hidden && !button.closest('[hidden]') && button.getAttribute('aria-disabled') !== 'true' && rect.width > 0 && rect.height > 0 && getComputedStyle(button).visibility !== 'hidden' && !['demo', 'connect', 'export'].includes(button.dataset.action ?? '');
    });
    if (!this.focus || !buttons.includes(this.focus)) this.select(buttons.find(button => button.matches(scope.primary)) ?? null);
    const result = this.controller.update({ players, capturedAt: frame.capturedAt, now, aspect: scope.aspect, context: scope.context + '/' + this.revision + '/' + (this.focus?.dataset.action ?? 'waiting') });
    const title = (this.focus?.getAttribute('aria-label') ?? this.focus?.textContent)?.trim().replace(/\s+/g, ' ').slice(0, 36) ?? '准备好后再确认';
    this.panel.querySelector('#motion-menu-status')!.textContent = (scope.members ? scope.members + ' · ' : '') + (scope.duo ? '主控菜单：' : '当前：') + title;
    this.panel.querySelector('#motion-menu-action')!.textContent = scope.binding ? scope.binding : scope.missing ? (scope.duo ? '等待主控伙伴，请让双肩和小手入镜' : '请让双肩和小手入镜') : result.gesture ? labels[result.gesture] + ' · 保持一下' : result.armed ? '动作后放松，再选下一项' : '双手放回胸口下方，再开始';
    this.panel.querySelector<HTMLProgressElement>('progress')!.value = result.progress;
    if (!buttons.length) return result.consumed;
    if (result.activated === 'next' || result.activated === 'previous') {
      const index = this.focus ? buttons.indexOf(this.focus) : -1;
      const next = (index + (result.activated === 'next' ? 1 : -1) + buttons.length) % buttons.length;
      this.select(buttons[next] ?? null);
    } else if (result.activated === 'confirm' && this.focus && buttons.includes(this.focus)) this.focus.click();
    else if (result.activated === 'back') this.back();
    return result.consumed;
  }
}
