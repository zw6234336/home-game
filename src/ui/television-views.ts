import { icon } from './icons.mjs';

export function decorateTelevisionScreen(markup: string, page: string, demo: boolean): string {
  if (!['device', 'calibration', 'game'].includes(page)) return markup;
  return markup + '<div class="tv-controls" role="group" aria-label="电视画面"><button id="tv-settings-toggle" data-action="tv-settings" aria-expanded="false">' + icon('camera') + '<span id="tv-settings-label">画面设置</span></button><button id="tv-fullscreen" data-action="fullscreen">' + icon('full') + '<span id="tv-fullscreen-label">电视全屏</span></button><button id="tv-standard" data-action="tv-standard">普通布局</button></div>' + (page === 'game' && demo ? '<span class="tv-demo-label">试玩 · 未使用摄像头</span>' : '');
}

export function televisionPauseActions(): string {
  return '<div class="tv-pause-actions"><button class="button secondary full" data-action="fullscreen">电视全屏</button><button class="button quiet full" data-action="tv-standard">返回普通布局</button></div>';
}
