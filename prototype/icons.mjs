const paths = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  full: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5zM16 9l6 6m0-6-6 6"/>',
  camera: '<rect x="2" y="5" width="20" height="14" rx="4"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  person: '<circle cx="12" cy="6" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  duo: '<circle cx="8" cy="7" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m1 3a6 6 0 0 1 5 5v2"/>',
  spark: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 8M3 3v7h7"/>',
  shield: '<path d="m12 2 8 3v7c0 5-8 9-8 9s-8-4-8-9V5z"/><path d="m8 12 3 3 5-6"/>'
};
export function icon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.spark) + '</svg>';
}
