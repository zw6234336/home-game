import { gameArtCatalog, gameArtUrl, type GameArt } from '../art/catalog.ts';

async function loadImage(url: string): Promise<CanvasImageSource> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

export class GameArtCache {
  private images = new Map<GameArt, CanvasImageSource>();
  private loading: Promise<void> | null = null;
  private loader: (url: string) => Promise<CanvasImageSource>;

  constructor(loader = loadImage) {
    this.loader = loader;
  }

  preload(): Promise<void> {
    this.loading ??= Promise.all((Object.keys(gameArtCatalog) as GameArt[]).map(async name => {
      try {
        this.images.set(name, await this.loader(gameArtUrl(name)));
      } catch {
        this.images.delete(name);
      }
    })).then(() => undefined);
    return this.loading;
  }

  get(name: GameArt): CanvasImageSource | null {
    return this.images.get(name) ?? null;
  }
}

export const gameArt = new GameArtCache();
