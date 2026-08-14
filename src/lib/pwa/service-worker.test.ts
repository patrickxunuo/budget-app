// @vitest-environment node
// This suite is pure Node: no DOM is needed, and skipping jsdom keeps the
// full-suite memory footprint down.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * The cache policy in `public/sw.js` is a security boundary, so this suite
 * executes the shipped worker source rather than re-describing it. The worker
 * is evaluated against fakes for `self`, `caches`, `fetch`, and `Request`, and
 * every cache open/read/write is logged so "never cached" can be asserted
 * positively instead of inferred.
 */
const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://budget.example";

type FakeResponse = {
  id: string;
  ok: boolean;
  status: number;
  type: string;
  clone: () => FakeResponse;
};

type ResponseOptions = { ok?: boolean; status?: number; type?: string };

function makeResponse(id: string, options: ResponseOptions = {}): FakeResponse {
  const { ok = true, status = 200, type = "basic" } = options;
  return {
    id,
    ok,
    status,
    type,
    clone: () => makeResponse(id, { ok, status, type }),
  };
}

type RequestInitLike = {
  method?: string;
  mode?: string;
  headers?: Record<string, string>;
  cache?: string;
};

class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly headers: Headers;

  constructor(input: string | FakeRequest, init: RequestInitLike = {}) {
    const raw = typeof input === "string" ? input : input.url;
    this.url = new URL(raw, ORIGIN).toString();
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "cors";
    this.headers = new Headers(init.headers ?? {});
  }
}

function keyOf(target: string | { url: string }): string {
  const raw = typeof target === "string" ? target : target.url;
  return new URL(raw, ORIGIN).toString();
}

type CacheLog = {
  opens: string[];
  matches: Array<{ cache: string; key: string }>;
  puts: Array<{ cache: string; key: string; response: FakeResponse }>;
  deletes: string[];
};

class FakeCache {
  readonly entries = new Map<string, FakeResponse>();

  constructor(
    private readonly name: string,
    private readonly log: CacheLog,
  ) {}

  async match(target: string | { url: string }) {
    const key = keyOf(target);
    this.log.matches.push({ cache: this.name, key });
    return this.entries.get(key);
  }

  async put(target: string | { url: string }, response: FakeResponse) {
    const key = keyOf(target);
    this.log.puts.push({ cache: this.name, key, response });
    this.entries.set(key, response);
  }

  async delete(target: string | { url: string }) {
    return this.entries.delete(keyOf(target));
  }

  async keys() {
    return [...this.entries.keys()];
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>();

  constructor(private readonly log: CacheLog) {}

  async open(name: string) {
    this.log.opens.push(name);
    const existing = this.stores.get(name);
    if (existing) return existing;
    const created = new FakeCache(name, this.log);
    this.stores.set(name, created);
    return created;
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    this.log.deletes.push(name);
    return this.stores.delete(name);
  }

  async has(name: string) {
    return this.stores.has(name);
  }
}

function createFetchEvent(request: FakeRequest) {
  const waited: Array<Promise<unknown>> = [];
  let responded: Promise<unknown> | undefined;
  const respondWith = vi.fn((value: unknown) => {
    responded = Promise.resolve(value);
  });
  const waitUntil = vi.fn((value: unknown) => {
    waited.push(Promise.resolve(value));
  });
  return {
    request,
    respondWith,
    waitUntil,
    waited,
    get responded() {
      return responded;
    },
  };
}

/** Drains every pending microtask, including a detached background refresh. */
async function flush() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type WorkerEvent = Record<string, unknown> & {
  waitUntil?: (value: unknown) => void;
};

function createWorker() {
  const log: CacheLog = { opens: [], matches: [], puts: [], deletes: [] };
  const caches = new FakeCacheStorage(log);
  const handlers = new Map<string, Array<(event: unknown) => void>>();
  const skipWaiting = vi.fn();
  const claim = vi.fn(async () => undefined);
  const fetchMock = vi.fn(
    async (request: FakeRequest | string): Promise<FakeResponse> =>
      makeResponse(`network:${keyOf(request)}`),
  );

  const scope = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    location: { origin: ORIGIN },
    skipWaiting,
    clients: { claim },
  };

  const evaluate = new Function(
    "self",
    "caches",
    "fetch",
    "Request",
    "Response",
    SOURCE,
  ) as (
    self: unknown,
    caches: unknown,
    fetch: unknown,
    request: unknown,
    response: unknown,
  ) => void;

  evaluate(scope, caches, fetchMock, FakeRequest, Response);

  function dispatch(type: string, event: unknown) {
    const list = handlers.get(type) ?? [];
    expect(
      list.length,
      `public/sw.js registered no "${type}" listener`,
    ).toBeGreaterThan(0);
    for (const handler of list) handler(event);
  }

  async function dispatchLifecycle(type: string) {
    const waited: Array<Promise<unknown>> = [];
    const event: WorkerEvent = {
      waitUntil: (value: unknown) => {
        waited.push(Promise.resolve(value));
      },
    };
    dispatch(type, event);
    expect(waited.length, `${type} must call waitUntil`).toBeGreaterThan(0);
    await Promise.all(waited);
    return waited;
  }

  async function dispatchFetch(path: string, init: RequestInitLike = {}) {
    const event = createFetchEvent(new FakeRequest(path, init));
    dispatch("fetch", event);
    return event;
  }

  async function currentCacheName() {
    const names = await caches.keys();
    const current = names.find((name) => name.startsWith("budget-app-static-"));
    expect(current, "no versioned static cache was created").toBeTypeOf(
      "string",
    );
    return current as string;
  }

  function totalCachedEntries() {
    let total = 0;
    for (const store of caches.stores.values()) total += store.entries.size;
    return total;
  }

  return {
    caches,
    claim,
    dispatch,
    dispatchFetch,
    dispatchLifecycle,
    currentCacheName,
    fetchMock,
    log,
    skipWaiting,
    totalCachedEntries,
  };
}

/** Same-origin requests that must pass straight through, untouched. */
const PASSTHROUGH_REQUESTS: Array<[string, RequestInitLike]> = [
  ["/api/transactions", { mode: "cors" }],
  ["/api/dashboard?scope=family", { mode: "cors" }],
  ["/api/budgets", { mode: "cors" }],
  ["/api/plaid/status", { mode: "cors" }],
  ["/api/plaid/sync", { mode: "cors" }],
  ["/auth/confirm", { mode: "same-origin" }],
  ["/dashboard", { mode: "same-origin" }],
  ["/transactions", { mode: "same-origin" }],
  ["/accounts", { mode: "same-origin" }],
  ["/budgets", { mode: "same-origin" }],
  ["/categories", { mode: "same-origin" }],
  ["/settings/members", { mode: "same-origin" }],
  ["/sign-in", { mode: "same-origin" }],
];

const CROSS_ORIGIN_REQUESTS: string[] = [
  "https://abcdefghijklm.supabase.co/rest/v1/transactions?select=*",
  "https://abcdefghijklm.supabase.co/auth/v1/token?grant_type=refresh_token",
  "https://production.plaid.com/transactions/sync",
  "https://cdn.plaid.com/link/v2/stable/link-initialize.js",
];

const SHELL_REQUESTS = [
  "/icons/icon-192.png",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/offline",
];

describe("GH-13 the worker never touches financial data (AC6)", () => {
  it.each(PASSTHROUGH_REQUESTS)(
    "SW-001 leaves GET %s entirely to the browser",
    async (path, init) => {
      const worker = createWorker();

      const event = await worker.dispatchFetch(path, init);
      await flush();

      expect(event.respondWith).not.toHaveBeenCalled();
      expect(event.responded).toBeUndefined();
      expect(worker.fetchMock).not.toHaveBeenCalled();
      expect(worker.log.opens).toEqual([]);
      expect(worker.log.matches).toEqual([]);
      expect(worker.log.puts).toEqual([]);
      expect(worker.totalCachedEntries()).toBe(0);
    },
  );

  it.each(CROSS_ORIGIN_REQUESTS)(
    "SW-002 leaves cross-origin GET %s entirely to the browser",
    async (url) => {
      const worker = createWorker();

      const event = await worker.dispatchFetch(url, { mode: "cors" });
      await flush();

      expect(event.respondWith).not.toHaveBeenCalled();
      expect(worker.log.matches).toEqual([]);
      expect(worker.log.puts).toEqual([]);
      expect(worker.totalCachedEntries()).toBe(0);
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])(
    "SW-003 never caches a %s to an otherwise-cacheable path",
    async (method) => {
      const worker = createWorker();

      const event = await worker.dispatchFetch("/_next/static/chunks/x.js", {
        method,
        mode: "cors",
      });
      await flush();

      expect(event.respondWith).not.toHaveBeenCalled();
      expect(worker.log.puts).toEqual([]);
      expect(worker.totalCachedEntries()).toBe(0);
    },
  );

  it("SW-004 never caches a range request, whose body is partial", async () => {
    const worker = createWorker();

    const event = await worker.dispatchFetch("/_next/static/chunks/x.js", {
      mode: "cors",
      headers: { Range: "bytes=0-1023" },
    });
    await flush();

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(worker.log.puts).toEqual([]);
    expect(worker.totalCachedEntries()).toBe(0);
  });
});

describe("GH-13 the static allowlist is cache-first (AC6)", () => {
  it("SW-005 serves an immutable build asset from the network once, then from cache", async () => {
    const worker = createWorker();
    const path = "/_next/static/chunks/main-abc123.js";

    const first = await worker.dispatchFetch(path, { mode: "cors" });
    expect(first.respondWith).toHaveBeenCalledTimes(1);
    const fromNetwork = (await first.responded) as FakeResponse;
    await flush();

    expect(fromNetwork.id).toBe(`network:${keyOf(path)}`);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(worker.log.puts).toHaveLength(1);
    expect(worker.log.puts[0]?.key).toBe(keyOf(path));

    const second = await worker.dispatchFetch(path, { mode: "cors" });
    const fromCache = (await second.responded) as FakeResponse;
    await flush();

    expect(fromCache.id).toBe(`network:${keyOf(path)}`);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(worker.log.puts).toHaveLength(1);
  });
});

describe("GH-13 the shell is stale-while-revalidate (AC6, AC7)", () => {
  it.each(SHELL_REQUESTS)(
    "SW-006 serves %s from cache immediately and refreshes it in the background",
    async (path) => {
      const worker = createWorker();
      await worker.dispatchLifecycle("install");
      const cache = await worker.caches.open(await worker.currentCacheName());
      cache.entries.clear();
      cache.entries.set(keyOf(path), makeResponse("cached"));
      worker.fetchMock.mockClear();
      worker.fetchMock.mockResolvedValue(makeResponse("fresh"));

      const event = await worker.dispatchFetch(path, { mode: "cors" });
      const served = (await event.responded) as FakeResponse;

      expect(served.id).toBe("cached");

      await flush();

      expect(worker.fetchMock).toHaveBeenCalledTimes(1);
      expect(cache.entries.get(keyOf(path))?.id).toBe("fresh");
    },
  );

  it("SW-007 falls back to the network when the shell is not cached yet", async () => {
    const worker = createWorker();
    worker.fetchMock.mockResolvedValue(makeResponse("fresh"));

    const event = await worker.dispatchFetch("/manifest.webmanifest", {
      mode: "cors",
    });
    const served = (await event.responded) as FakeResponse;
    await flush();

    expect(served.id).toBe("fresh");
    expect(worker.log.puts).toHaveLength(1);
  });
});

describe("GH-13 unusable responses are never stored (AC6)", () => {
  it.each([
    ["a non-ok response", { ok: false, status: 404 }],
    ["a server error", { ok: false, status: 503 }],
    ["an opaque response", { ok: true, type: "opaque" }],
  ])("SW-008 does not store %s", async (_label, options) => {
    const worker = createWorker();
    worker.fetchMock.mockResolvedValue(makeResponse("unusable", options));

    const immutable = await worker.dispatchFetch(
      "/_next/static/chunks/bad.js",
      { mode: "cors" },
    );
    await immutable.responded;
    const shell = await worker.dispatchFetch("/icons/icon-512.png", {
      mode: "cors",
    });
    await shell.responded;
    await flush();

    expect(worker.log.puts).toEqual([]);
    expect(worker.totalCachedEntries()).toBe(0);
  });
});

describe("GH-13 navigations are network-first and never cached (AC6, AC7)", () => {
  it("SW-009 returns the network document without writing it to a cache", async () => {
    const worker = createWorker();
    worker.fetchMock.mockResolvedValue(makeResponse("live-dashboard"));

    const event = await worker.dispatchFetch("/dashboard", {
      mode: "navigate",
    });
    const served = (await event.responded) as FakeResponse;
    await flush();

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    expect(served.id).toBe("live-dashboard");
    expect(worker.log.puts).toEqual([]);
    expect(worker.totalCachedEntries()).toBe(0);
  });

  it("SW-010 serves the precached offline document when the network fails", async () => {
    const worker = createWorker();
    await worker.dispatchLifecycle("install");
    const cacheName = await worker.currentCacheName();
    const cache = await worker.caches.open(cacheName);
    cache.entries.set(keyOf("/offline"), makeResponse("offline-shell"));

    worker.fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const event = await worker.dispatchFetch("/transactions", {
      mode: "navigate",
    });
    const served = (await event.responded) as FakeResponse;
    await flush();

    expect(served.id).toBe("offline-shell");
    expect(
      worker.log.puts.some((entry) => entry.key === keyOf("/transactions")),
    ).toBe(false);
  });
});

describe("GH-13 install precaches the data-free shell (AC7, AC8)", () => {
  it("SW-011 precaches the offline document without calling skipWaiting", async () => {
    const worker = createWorker();

    await worker.dispatchLifecycle("install");

    expect(worker.skipWaiting).not.toHaveBeenCalled();
    const cacheName = await worker.currentCacheName();
    expect(cacheName).toMatch(/^budget-app-static-v\d+$/);
    const cache = await worker.caches.open(cacheName);
    const keys = await cache.keys();
    expect(keys).toContain(keyOf("/offline"));
    expect(keys).toContain(keyOf("/manifest.webmanifest"));
    expect(keys.some((key) => key.includes("/icons/icon-192.png"))).toBe(true);
    expect(
      keys.every((key) => !key.includes("/api/") && !key.includes("dashboard")),
    ).toBe(true);
  });

  it("SW-012 survives a partial precache failure", async () => {
    const worker = createWorker();
    worker.fetchMock.mockImplementation(async (request) => {
      const key = keyOf(request);
      if (key.endsWith("/icons/maskable-512.png")) {
        throw new TypeError("Failed to fetch");
      }
      if (key.endsWith("/favicon.ico") || key.endsWith("/icons/icon-512.png")) {
        return makeResponse("missing", { ok: false, status: 404 });
      }
      return makeResponse(`network:${key}`);
    });

    const waited = await worker.dispatchLifecycle("install");

    await expect(Promise.all(waited)).resolves.toBeDefined();
    const cache = await worker.caches.open(await worker.currentCacheName());
    const keys = await cache.keys();
    expect(keys).toContain(keyOf("/offline"));
    expect(keys).not.toContain(keyOf("/icons/maskable-512.png"));
    expect(keys).not.toContain(keyOf("/icons/icon-512.png"));
  });
});

describe("GH-13 activate reclaims clients and drops stale caches (AC8)", () => {
  it("SW-013 deletes every cache that is not the current one", async () => {
    const worker = createWorker();
    await worker.dispatchLifecycle("install");
    const cacheName = await worker.currentCacheName();
    await worker.caches.open("budget-app-static-v0");
    await worker.caches.open("budget-app-static-v-old");
    await worker.caches.open("workbox-precache");

    await worker.dispatchLifecycle("activate");

    expect(await worker.caches.keys()).toEqual([cacheName]);
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });
});

describe("GH-13 a waiting worker activates only on request (AC8)", () => {
  it("SW-014 skips waiting only for an explicit SKIP_WAITING message", async () => {
    const worker = createWorker();

    worker.dispatch("message", { data: { type: "SKIP_WAITING" } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);

    worker.dispatch("message", { data: { type: "PING" } });
    worker.dispatch("message", { data: { type: "skip_waiting" } });
    worker.dispatch("message", { data: "SKIP_WAITING" });
    worker.dispatch("message", { data: null });
    worker.dispatch("message", {});

    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
