import { adventureKeys, adventureUrl, adventureWorlds, type AdventureWorld } from '../art/worlds.ts';
import { heartsTreasures } from './hearts-views.ts';
import { icon } from './icons.mjs';

export function adventurePicture(game: AdventureWorld, variant = '', thumbnail = false): string {
  const world = adventureWorlds[game];
  return '<span class="adventure-picture ' + variant + '" data-art-state="loading"><span class="art-fallback" aria-hidden="true">' + icon('spark') + '<span>' + world.name + '</span></span><img src="' + adventureUrl(game, thumbnail) + '" alt="' + (thumbnail ? '' : world.description) + '" width="' + (thumbnail ? 240 : 1440) + '" height="' + (thumbnail ? 160 : 960) + '" decoding="async"></span>';
}

export function adventureChoices(game: string): string {
  return '<div class="game-choices adventure-choices" role="group" aria-label="选择游戏">' + adventureKeys.map(key => '<button id="game-' + key + '" data-action="select-' + key + '" aria-label="' + adventureWorlds[key].name + '" aria-pressed="' + (game === key) + '">' + adventurePicture(key, 'choice-picture', true) + '<span class="choice-name">' + adventureWorlds[key].name + '</span><span class="choice-selected" aria-hidden="true">' + icon('spark') + '</span></button>').join('') + '</div>';
}

export function adventureFeature(game: AdventureWorld): string {
  const world = adventureWorlds[game];
  return '<section class="adventure-feature" data-world="' + game + '" aria-label="' + world.name + '游戏介绍"><div class="adventure-heading"><div><small>今天的共同冒险</small><h2>' + world.name + '</h2></div><span class="adventure-duration">' + world.duration + '</span></div><div class="adventure-window">' + adventurePicture(game, 'hero-picture') + '<span class="adventure-postcard">' + icon('spark') + world.invitation + '</span><span class="adventure-glints" aria-hidden="true"><i></i><i></i><i></i></span></div><div class="adventure-tags">' + world.tags.map(tag => '<span>' + tag + '</span>').join('') + '</div></section>' + (game === 'hearts' ? '<div class="adventure-treasures" aria-label="童话道具与变身说明">' + heartsTreasures() + '</div>' : '');
}

export function adventureNote(game: AdventureWorld, caption: string): string {
  return '<div class="adventure-note">' + adventurePicture(game, 'note-picture', true) + '<div><small>' + adventureWorlds[game].name + '</small><p>' + caption + '</p></div></div>';
}

export function adventureResults(game: AdventureWorld): string {
  return '<div class="adventure-result"><div class="result-world">' + adventurePicture(game, 'result-picture') + '</div><span class="result-keepsake">' + icon('duo') + '我们的共同小成就</span><span class="result-stars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></div>';
}

export function decorateAdventureScreen(html: string, game: AdventureWorld, page: string): string {
  if (page === 'results') {
    return html.replace(/<div class="results-illustration">.*?<\/div>|<div class="pose-result-art">.*?<\/div>/s, adventureResults(game));
  }
  if (page === 'device' || page === 'calibration') {
    return html.replace('<section class="setup-copy">', '<section class="setup-copy">' + adventureNote(game, page === 'device' ? '接好镜头，我们的小世界就要打开了。' : adventureWorlds[game].action));
  }
  if (page === 'game') {
    const sparks = '<div class="visual-reward" aria-hidden="true">' + Array.from({ length: 8 }, () => '<i></i>').join('') + '</div>';
    return html.replace('<div id="countdown"', sparks + '<div id="countdown"').replace('class="countdown-overlay">', 'class="countdown-overlay">' + adventurePicture(game, 'countdown-picture', true));
  }
  return html;
}
