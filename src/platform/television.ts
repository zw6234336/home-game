const MAX_STAGE_PIXELS = 3_200_000;

type FullscreenHost = Pick<Document, 'fullscreenElement' | 'fullscreenEnabled' | 'exitFullscreen'> & { documentElement: Pick<HTMLElement, 'requestFullscreen'> };

export function stagePixelRatio(width: number, height: number, density: number): number {
  if (![width, height, density].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Stage size and density must be positive');
  return Math.min(density, 1.5, Math.sqrt(MAX_STAGE_PIXELS / (width * height)));
}

export async function enterTvFullscreen(host: FullscreenHost = document): Promise<boolean> {
  if (host.fullscreenElement) return true;
  if (!host.fullscreenEnabled || typeof host.documentElement.requestFullscreen !== 'function') return false;
  try {
    await host.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return Boolean(host.fullscreenElement);
  } catch { return false; }
}

export async function exitTvFullscreen(host: FullscreenHost = document): Promise<boolean> {
  if (!host.fullscreenElement) return true;
  try {
    await host.exitFullscreen();
    return !host.fullscreenElement;
  } catch { return false; }
}
