export const gameArtCatalog = {
  slipper: { file: 'crystal-slipper', label: '水晶鞋', points: 10 },
  handbag: { file: 'storybook-handbag', label: '星星包包', points: 10 },
  dress: { file: 'princess-dress', label: '公主裙', points: 20 },
  crown: { file: 'royal-crown', label: '宝石皇冠', points: 30 },
  bomb: { file: 'surprise-bomb', label: '变身炸弹', points: -20 },
  donkey: { file: 'donkey-mask', label: '小驴脸', points: 0 },
  piglet: { file: 'piglet-mask', label: '小猪脸', points: 0 },
} as const;

export type GameArt = keyof typeof gameArtCatalog;
export type TreasureArt = 'slipper' | 'handbag' | 'dress' | 'crown';

export function gameArtUrl(name: GameArt): string {
  return '/art/storybook-v1/' + gameArtCatalog[name].file + '.webp';
}

export function treasureForTier(tier: 'pink' | 'big' | 'gold', serial: number): TreasureArt | null {
  if (serial % 4 === 0) return null;
  if (tier === 'gold') return 'crown';
  if (tier === 'big') return 'dress';
  return serial % 2 === 0 ? 'handbag' : 'slipper';
}
