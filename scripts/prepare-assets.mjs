import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = [
  ['pose_landmarker_full.task', 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1'],
  ['pose_landmarker_lite.task', 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'],
  ['hand_landmarker.task', 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1']
];
const manifest = { package: '@mediapipe/tasks-vision@1.2.3', files: [] };
await mkdir(path.join(root, 'public/models'), { recursive: true });
await mkdir(path.join(root, 'public/wasm'), { recursive: true });
for (const [name, url, expectedHash] of assets) {
  const destination = path.join(root, 'public/models', name);
  let bytes;
  try { bytes = await readFile(destination); } catch { bytes = null; }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Model download failed: ' + name + ' ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Model checksum mismatch: ' + name);
    await writeFile(destination, bytes);
  }
  manifest.files.push({ path: '/models/' + name, source: url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(name + ': ' + bytes.length + ' bytes');
}
const wasmSource = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
for (const name of await readdir(wasmSource)) {
  if (!/\.(js|wasm)$/.test(name)) continue;
  await copyFile(path.join(wasmSource, name), path.join(root, 'public/wasm', name));
  const bytes = await readFile(path.join(wasmSource, name));
  manifest.files.push({ path: '/wasm/' + name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(root, 'public/asset-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Local assets ready; runtime requires no CDN.');
