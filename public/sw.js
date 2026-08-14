/**
 * Budget App service worker.
 *
 * The only reason this worker exists is installability and a data-free offline
 * screen. It is deny-by-default: a response reaches a cache only when it is a
 * same-origin GET for a path on the static allowlist below. Transactions,
 * balances, budgets, sessions, and every Plaid or Supabase response travel
 * straight to the network and are never read from or written to a cache, so an
 * installed copy can never show stale money or leak a member's data to the next
 * person holding the device.
 *
 * Bump CACHE_VERSION whenever the precached shell changes; `activate` deletes
 * every cache that is not the current one.
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `budget-app-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

/** The data-free shell. A failed member fetch must never end up in here. */
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

/** Content-hashed build output: immutable, so cache-first is safe. */
const IMMUTABLE_PREFIX = "/_next/static/";

/** Stable shell URLs that are refreshed in the background when reachable. */
const SHELL_PATHS = new Set([
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/favicon.ico",
]);

const SHELL_PREFIX = "/icons/";

function isImmutableAsset(pathname) {
  return pathname.startsWith(IMMUTABLE_PREFIX);
}

function isShellAsset(pathname) {
  return SHELL_PATHS.has(pathname) || pathname.startsWith(SHELL_PREFIX);
}

/**
 * The single gate every cache read and write passes through. Anything not
 * explicitly listed here — `/api/**`, every application document, every
 * cross-origin request, every non-GET — is not cacheable.
 */
function isCacheable(request, origin) {
  if (request.method !== "GET") return false;
  // Range requests produce partial (206) bodies that must not be stored.
  if (request.headers && request.headers.has && request.headers.has("range")) {
    return false;
  }
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  return isImmutableAsset(url.pathname) || isShellAsset(url.pathname);
}

function isStorableResponse(response) {
  return Boolean(response) && response.ok && response.type !== "opaque";
}

self.addEventListener("install", (event) => {
  // Deliberately no skipWaiting(): a waiting worker activates only when a page
  // asks for it, so an update can never swap the app out from under a member
  // mid-interaction.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // allSettled, not all: one unreachable icon must not fail the install.
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (!isStorableResponse(response)) {
            throw new Error(`Precache skipped ${url}`);
          }
          await cache.put(url, response);
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/**
 * Storing is best-effort. `Cache.put` rejects on a full device
 * (QuotaExceededError) and on responses it refuses to store, and none of that
 * is a reason to fail a request the network already answered — letting it
 * throw would turn a delivered `/_next/static` chunk into a failed asset and
 * stop the app booting.
 */
async function store(cache, request, response) {
  try {
    await cache.put(request, response.clone());
  } catch {
    // Serving the response matters; caching it is an optimisation.
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isStorableResponse(response)) {
    await store(cache, request, response);
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (isStorableResponse(response)) {
        await store(cache, request, response);
      }
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    // Keep the worker alive for the refresh; a terminated worker would drop it
    // and the shell would stay on the stale copy indefinitely.
    if (event) event.waitUntil(network);
    return cached;
  }
  const response = await network;
  if (response) return response;
  throw new Error(`Unable to fetch ${request.url}`);
}

/**
 * Navigations are network-first and are never cached — an application document
 * carries the member's financial data. Only when the network fails do we serve
 * the precached, data-free offline screen.
 */
async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(STATIC_CACHE);
    const fallback = await cache.match(OFFLINE_URL);
    if (fallback) return fallback;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.mode === "navigate" && request.method === "GET") {
    event.respondWith(navigateOrOffline(request));
    return;
  }

  if (!isCacheable(request, self.location.origin)) {
    // Untouched: no respondWith at all, so the browser handles it normally and
    // the worker never observes or stores the body.
    return;
  }

  const pathname = new URL(request.url).pathname;
  event.respondWith(
    isImmutableAsset(pathname)
      ? cacheFirst(request)
      : staleWhileRevalidate(request, event),
  );
});
