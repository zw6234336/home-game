import type { WorkerRequest, WorkerResponse } from '../protocol.ts';

export interface VisionWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface VisionRuntime {
  now(): number;
  createWorker(): VisionWorker;
  createCanvas(): HTMLCanvasElement;
  createBitmap(canvas: HTMLCanvasElement): Promise<ImageBitmap>;
  scheduleFrame(video: HTMLVideoElement, callback: (mediaTime: number) => void): () => void;
  deadline(callback: () => void, milliseconds: number): () => void;
}

export function browserVisionRuntime(): VisionRuntime {
  return {
    now: () => performance.now(),
    createWorker: () => new Worker(new URL('../inference.worker.ts', import.meta.url), { type: 'module', name: 'local-motion-vision' }),
    createCanvas: () => document.createElement('canvas'),
    createBitmap: canvas => createImageBitmap(canvas),
    scheduleFrame(video, callback) {
      if (typeof video.requestVideoFrameCallback === 'function') {
        const id = video.requestVideoFrameCallback((_now, metadata) => callback(metadata.mediaTime));
        return () => video.cancelVideoFrameCallback(id);
      }
      const id = requestAnimationFrame(() => callback(video.currentTime));
      return () => cancelAnimationFrame(id);
    },
    deadline(callback, milliseconds) {
      const id = setTimeout(callback, milliseconds);
      return () => clearTimeout(id);
    },
  };
}

export function retireWorker(worker: VisionWorker, runtime: VisionRuntime): void {
  let retired = false;
  let cancelDeadline = () => {};
  const terminate = () => {
    if (retired) return;
    retired = true;
    cancelDeadline();
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
  };
  worker.onmessage = event => {
    if (event.data.type === 'disposed') terminate();
  };
  worker.onerror = terminate;
  worker.onmessageerror = terminate;
  cancelDeadline = runtime.deadline(terminate, 2000);
  try {
    worker.postMessage({ type: 'dispose' });
  } catch {
    terminate();
  }
}
