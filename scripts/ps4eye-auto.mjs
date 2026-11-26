import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delayMs, startManagedInterval } from './scheduler.mjs';

function defaultExecFile(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      const code = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

const runtimeState = new Map();

function getState(binPath) {
  let entry = runtimeState.get(binPath);
  if (!entry) {
    entry = { inflight: null, lastUploadAt: -Infinity };
    runtimeState.set(binPath, entry);
  }
  return entry;
}

export function resolvePs4EyePaths(rootDir = process.cwd()) {
  const dir = path.join(rootDir, '.ps4eye');
  return {
    dir,
    binPath: path.join(dir, 'ps4eye_init'),
    fwPath: path.join(dir, 'firmware.bin'),
    srcPath: path.join(rootDir, 'scripts', 'ps4eye_init.c'),
  };
}

export async function compilePs4EyeLoader(paths, deps = {}) {
  const existsSync = deps.existsSync ?? fs.existsSync;
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  const statSync = deps.statSync ?? fs.statSync;
  const exec = deps.execFileAsync ?? defaultExecFile;

  const hasBin = existsSync(paths.binPath);
  const hasSrc = existsSync(paths.srcPath);
  if (hasBin && (!hasSrc || statSync(paths.binPath).mtimeMs >= statSync(paths.srcPath).mtimeMs)) {
    return true;
  }
  if (!hasSrc) return hasBin;

  mkdirSync(paths.dir, { recursive: true });
  const candidates = [];
  const pkg = await exec('pkg-config', ['--cflags', '--libs', 'libusb-1.0']);
  if (pkg.code === 0 && pkg.stdout.trim()) {
    candidates.push(pkg.stdout.trim().split(/\s+/));
  }
  candidates.push(['-I/opt/homebrew/include', '-L/opt/homebrew/lib', '-lusb-1.0']);
  candidates.push(['-I/usr/local/include', '-L/usr/local/lib', '-lusb-1.0']);

  for (const flags of candidates) {
    const res = await exec('cc', ['-O2', paths.srcPath, '-o', paths.binPath, ...flags]);
    if (res.code === 0) return true;
  }
  return existsSync(paths.binPath);
}

export async function ensurePs4Eye(options = {}) {
  const rootDir = options.rootDir ?? process.cwd();
  const paths = resolvePs4EyePaths(rootDir);
  const state = options.stateCache ?? getState(paths.binPath);
  if (state.inflight) return state.inflight;

  const exec = options.execFileAsync ?? defaultExecFile;
  const existsSync = options.existsSync ?? fs.existsSync;
  const statSync = options.statSync ?? fs.statSync;
  const mkdirSync = options.mkdirSync ?? fs.mkdirSync;
  const sleep = options.sleep ?? delayMs;
  const now = options.now ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 5000;

  const run = async () => {
    const loaderReady = await compilePs4EyeLoader(paths, {
      existsSync,
      mkdirSync,
      statSync,
      execFileAsync: exec,
    });
    if (!loaderReady) {
      return {
        state: 'unavailable',
        ready: false,
        initializedNow: false,
        message: '当前环境未安装 libusb 或 ps4eye_init 引导程序',
      };
    }

    const probe = await exec(paths.binPath, ['--check']);
    const probeText = probe.stdout.trim();
    if (probe.code === 0 || probeText === 'ready') {
      return {
        state: 'ready',
        ready: true,
        initializedNow: false,
        message: 'PS4 体感摄像头已就绪（USB Camera-OV580）',
      };
    }
    if (probe.code === 2 || probeText === 'absent') {
      return {
        state: 'absent',
        ready: false,
        initializedNow: false,
        message: '未检测到 PS4 体感摄像头，请检查 USB 3.0 连接',
      };
    }
    if (probe.code !== 10 && probeText !== 'boot') {
      return {
        state: 'error',
        ready: false,
        initializedNow: false,
        message: '检测 PS4 摄像头状态失败（exit ' + probe.code + '）',
      };
    }

    if (now() - state.lastUploadAt < cooldownMs) {
      return {
        state: 'initializing',
        ready: false,
        initializedNow: false,
        message: '已发送 PS4 摄像头固件，正在等待系统识别……',
      };
    }

    if (!existsSync(paths.fwPath)) {
      return {
        state: 'missing_firmware',
        ready: false,
        initializedNow: false,
        message: '检测到 PS4 摄像头引导模式，但缺少 .ps4eye/firmware.bin',
      };
    }

    state.lastUploadAt = now();
    const initRes = await exec(paths.binPath, [paths.fwPath]);
    if (initRes.code !== 0) {
      return {
        state: 'error',
        ready: false,
        initializedNow: false,
        message: '加载 PS4 摄像头固件失败：' + (initRes.stderr.trim() || initRes.stdout.trim() || 'exit ' + initRes.code),
      };
    }

    for (let attempt = 0; attempt < 14; attempt += 1) {
      await sleep(250);
      const next = await exec(paths.binPath, ['--check']);
      if (next.code === 0 || next.stdout.trim() === 'ready') {
        return {
          state: 'initialized',
          ready: true,
          initializedNow: true,
          message: '已自动检测到 PS4 摄像头并加载运行固件，USB Camera-OV580 已就绪',
        };
      }
    }

    return {
      state: 'initializing',
      ready: false,
      initializedNow: true,
      message: '已发送 PS4 摄像头固件，正在等待系统识别……',
    };
  };

  state.inflight = run().finally(() => {
    state.inflight = null;
  });
  return state.inflight;
}

export function startPs4EyeWatcher(options = {}) {
  const intervalMs = options.intervalMs ?? 3000;
  const logger = options.logger ?? console.log;
  let latest = {
    state: 'checking',
    ready: false,
    initializedNow: false,
    message: '正在检测 PS4 体感摄像头……',
  };
  let lastLoggedState = '';
  let stopped = false;

  const ensure = async () => {
    const result = await ensurePs4Eye(options);
    latest = result;
    if (result.state !== lastLoggedState) {
      lastLoggedState = result.state;
      logger(`[ps4eye] ${result.state}: ${result.message}`);
    }
    return result;
  };

  void ensure();
  const cancelTimer = startManagedInterval(() => {
    if (!stopped) void ensure();
  }, intervalMs);

  return {
    ensure,
    getStatus: () => latest,
    stop: () => {
      stopped = true;
      cancelTimer();
    },
  };
}

const isEntrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const result = await ensurePs4Eye();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ready && result.state !== 'absent' && result.state !== 'initializing') {
    process.exitCode = 1;
  }
}
