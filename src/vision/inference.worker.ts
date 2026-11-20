import { InferenceEngine } from './inference-engine.ts';
import { MediaPipeModelFactory } from './platform/mediapipe.ts';
import { installLocalWorkerNetwork } from './platform/local-network.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
};
installLocalWorkerNetwork();
const engine = new InferenceEngine(new MediaPipeModelFactory(), () => performance.now());
const operations = new Set<Promise<void>>();
let disposed = false;

async function handle(message: Exclude<WorkerRequest, { type: 'dispose' }>): Promise<void> {
  try {
    if (message.type === 'initialize') {
      const delegate = await engine.initialize(message.config, message.generation);
      if (!disposed && delegate) scope.postMessage({ type: 'ready', generation: message.generation, delegate });
    } else {
      const result = await engine.infer(message);
      if (disposed) return;
      if (result) scope.postMessage({ type: 'result', generation: message.generation, token: message.token, ...result });
      else scope.postMessage({ type: 'dropped', generation: message.generation, token: message.token });
    }
  } catch (error) {
    if (!disposed) scope.postMessage({ type: 'error', generation: message.generation, token: message.type === 'frame' ? message.token : undefined, message: error instanceof Error ? error.message : String(error) });
  }
}

scope.onmessage = event => {
  const message = event.data;
  if (message.type === 'dispose') {
    if (disposed) return;
    disposed = true;
    engine.dispose();
    void Promise.allSettled([...operations]).then(() => {
      engine.dispose();
      scope.postMessage({ type: 'disposed' });
      scope.close();
    });
    return;
  }
  if (disposed) {
    if (message.type === 'frame') message.bitmap.close();
    return;
  }
  const operation = handle(message);
  operations.add(operation);
  void operation.finally(() => operations.delete(operation));
};
