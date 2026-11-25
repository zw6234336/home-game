import { adventureUrl, type AdventureWorld } from '../art/worlds.ts';

export class WorldArtCache {
  private images = new Map<AdventureWorld, HTMLImageElement>();
  private pending = new Map<AdventureWorld, Promise<void>>();

  preload(game: AdventureWorld): Promise<void> {
    const current = this.pending.get(game);
    if (current) return current;
    const image = new Image();
    image.decoding = 'async';
    image.src = adventureUrl(game);
    const loading = image.decode().then(() => {
      this.images.set(game, image);
    }, () => {
      this.images.delete(game);
    });
    this.pending.set(game, loading);
    return loading;
  }

  get(game: AdventureWorld): HTMLImageElement | null {
    return this.images.get(game) ?? null;
  }
}

export function mountArtwork(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('.adventure-picture img').forEach(image => {
    const frame = image.parentElement!;
    void image.decode().then(() => { frame.dataset.artState = 'ready'; }, () => { frame.dataset.artState = 'failed'; });
  });
}

export const worldArt = new WorldArtCache();
