type WorkerNetwork = {
  fetch: typeof fetch;
  location: { href: string };
  XMLHttpRequest?: { prototype: Pick<XMLHttpRequest, 'open'> };
  importScripts?: (...urls: string[]) => void;
};

function assertLocalUrl(input: string | URL, baseUrl: string): void {
  const url = new URL(String(input), baseUrl);
  if (url.origin !== new URL(baseUrl).origin || !['http:', 'https:'].includes(url.protocol)) throw new DOMException('本地视觉 Worker 禁止外部网络请求', 'SecurityError');
}

export function localFetch(fetcher: typeof fetch, baseUrl: string): typeof fetch {
  return async (input, options) => {
    assertLocalUrl(input instanceof Request ? input.url : String(input), baseUrl);
    return fetcher(input, options);
  };
}

export function installLocalWorkerNetwork(scope: WorkerNetwork = globalThis): void {
  const baseUrl = scope.location.href;
  scope.fetch = localFetch(scope.fetch.bind(scope), baseUrl);
  if (scope.XMLHttpRequest) {
    const originalOpen = scope.XMLHttpRequest.prototype.open;
    scope.XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
      assertLocalUrl(url, baseUrl);
      originalOpen.call(this, method, url, async, username, password);
    };
  }
  if (scope.importScripts) {
    const originalImport = scope.importScripts.bind(scope);
    scope.importScripts = (...urls) => {
      for (const url of urls) assertLocalUrl(url, baseUrl);
      originalImport(...urls);
    };
  }
}
