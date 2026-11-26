import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensurePs4Eye, resolvePs4EyePaths, startPs4EyeWatcher } from '../scripts/ps4eye-auto.mjs';

test('ensurePs4Eye returns ready without uploading firmware when OV580 is active', async () => {
  const rootDir = '/tmp/ps4-ready-case';
  const paths = resolvePs4EyePaths(rootDir);
  const calls: string[][] = [];
  const result = await ensurePs4Eye({
    rootDir,
    stateCache: { inflight: null, lastUploadAt: -Infinity },
    existsSync: (target: string) => target === paths.binPath || target === paths.fwPath,
    statSync: () => ({ mtimeMs: 100 }),
    execFileAsync: async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { code: 0, stdout: 'ready\n', stderr: '' };
    },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.ready, true);
  assert.equal(result.initializedNow, false);
  assert.deepEqual(calls, [[paths.binPath, '--check']]);
});

test('ensurePs4Eye returns absent without uploading when no PS4 camera is attached', async () => {
  const rootDir = '/tmp/ps4-absent-case';
  const paths = resolvePs4EyePaths(rootDir);
  const calls: string[][] = [];
  const result = await ensurePs4Eye({
    rootDir,
    stateCache: { inflight: null, lastUploadAt: -Infinity },
    existsSync: (target: string) => target === paths.binPath,
    statSync: () => ({ mtimeMs: 100 }),
    execFileAsync: async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { code: 2, stdout: 'absent\n', stderr: '' };
    },
  });
  assert.equal(result.state, 'absent');
  assert.equal(result.ready, false);
  assert.equal(result.initializedNow, false);
  assert.equal(calls.length, 1);
});

test('ensurePs4Eye uploads firmware on boot mode, polls until ready, and enforces cooldown', async () => {
  const rootDir = '/tmp/ps4-boot-case';
  const paths = resolvePs4EyePaths(rootDir);
  const stateCache = { inflight: null, lastUploadAt: -Infinity };
  let clock = 10000;
  let checkCount = 0;
  let uploadCount = 0;

  const execFileAsync = async (_cmd: string, args: string[]) => {
    if (args[0] === '--check') {
      checkCount += 1;
      if (checkCount === 1) return { code: 10, stdout: 'boot\n', stderr: '' };
      if (checkCount === 2) return { code: 2, stdout: 'absent\n', stderr: '' };
      return { code: 0, stdout: 'ready\n', stderr: '' };
    }
    if (args[0] === paths.fwPath) {
      uploadCount += 1;
      return { code: 0, stdout: 'initialized\n', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };

  const initialized = await ensurePs4Eye({
    rootDir,
    stateCache,
    now: () => clock,
    sleep: async () => { clock += 250; },
    existsSync: (target: string) => target === paths.binPath || target === paths.fwPath,
    statSync: () => ({ mtimeMs: 100 }),
    execFileAsync,
  });

  assert.equal(initialized.state, 'initialized');
  assert.equal(initialized.ready, true);
  assert.equal(initialized.initializedNow, true);
  assert.equal(uploadCount, 1);
  assert.equal(checkCount, 3);

  const throttled = await ensurePs4Eye({
    rootDir,
    stateCache,
    now: () => clock + 500,
    cooldownMs: 5000,
    existsSync: (target: string) => target === paths.binPath || target === paths.fwPath,
    statSync: () => ({ mtimeMs: 100 }),
    execFileAsync: async () => ({ code: 10, stdout: 'boot\n', stderr: '' }),
  });

  assert.equal(throttled.state, 'initializing');
  assert.equal(throttled.ready, false);
  assert.equal(throttled.initializedNow, false);
});

test('ensurePs4Eye reports missing_firmware when boot device lacks firmware.bin', async () => {
  const rootDir = '/tmp/ps4-nofw-case';
  const paths = resolvePs4EyePaths(rootDir);
  const result = await ensurePs4Eye({
    rootDir,
    stateCache: { inflight: null, lastUploadAt: -Infinity },
    existsSync: (target: string) => target === paths.binPath,
    statSync: () => ({ mtimeMs: 100 }),
    execFileAsync: async () => ({ code: 10, stdout: 'boot\n', stderr: '' }),
  });
  assert.equal(result.state, 'missing_firmware');
  assert.equal(result.ready, false);
  assert.equal(result.initializedNow, false);
  assert.equal(path.basename(paths.fwPath), 'firmware.bin');
});

test('startPs4EyeWatcher initializes immediately, logs transitions once, and stops cleanly', async () => {
  const rootDir = '/tmp/ps4-watcher-case';
  const paths = resolvePs4EyePaths(rootDir);
  const logs: string[] = [];
  const watcher = startPs4EyeWatcher({
    rootDir,
    intervalMs: 60000,
    stateCache: { inflight: null, lastUploadAt: -Infinity },
    existsSync: (target: string) => target === paths.binPath,
    statSync: () => ({ mtimeMs: 100 }),
    execFileAsync: async () => ({ code: 0, stdout: 'ready\n', stderr: '' }),
    logger: (line: string) => logs.push(line),
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  await watcher.ensure();
  watcher.stop();
  assert.equal(watcher.getStatus().ready, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[ps4eye\] ready:/);
});
