import type { SpaceMode, SpacePreference } from '../game/space.ts';
export type { SpaceMode, SpacePreference };

export function spaceLabel(mode: SpaceMode) {
  return mode === 'compact' ? '小客厅 · 小幅动作' : '舒展空间 · 自动跟随';
}

export function spaceControls(preference: SpacePreference) {
  return '<div class="space-choice"><span>活动空间</span><div role="group" aria-label="选择活动空间"><button id="space-auto" data-action="space-auto" aria-pressed="' + (preference === 'auto') + '">自动适应</button><button id="space-compact" data-action="space-compact" aria-pressed="' + (preference === 'compact') + '">小客厅</button></div></div>';
}
