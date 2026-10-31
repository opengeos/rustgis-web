// The RustGIS web app's service worker: it lets the installed app (and the page) start offline.
//
// This file is a template. `cargo xtask web-pwa dist/web`, run after `trunk build` by the deploy
// workflows, fills in VERSION and SHELL with the built files (Trunk names them by content hash) and
// writes the result to dist/web/sw.js. A plain `trunk serve` or `trunk build` has no service worker.
//
// - The app shell (index.html, the hashed .js and .wasm, the manifest) is cached when the worker
//   installs. Hashed files are served cache-first; the page itself network-first, so a new deploy
//   is picked up whenever there is a connection.
// - Every other request (map tiles, the AI Assistant, plugins, data the user opens, analytics) is
//   left to the browser: the worker never answers or stores it.
// - A new deploy's worker waits until the page asks it to take over (the "new version" notice in
//   index.html) or every RustGIS window has closed, so the app never changes under the user.

const VERSION = "f9a83e0dadd9e182";
const SHELL = [
  "index.html",
  "manifest.webmanifest",
  "oauth-callback.html",
  "rustgis-web-73e2c6957f37f45b.js",
  "rustgis-web-73e2c6957f37f45b_bg.wasm",
  "snippets/rustgis-web-16bb2518e3b497a1/inline0.js",
];
// The icons and the loading logo, served from rustgis-assets: cached when reachable, but never
// required for the install to succeed.
const EXTRA = [
  "https://assets.rustgis.app/images/favicon.png",
  "https://assets.rustgis.app/images/logo.svg",
  "https://assets.rustgis.app/images/icon-192.png",
  "https://assets.rustgis.app/images/icon-512.png",
  "https://assets.rustgis.app/images/icon-maskable-512.png",
  "https://assets.rustgis.app/images/apple-touch-icon.png",
];

// Caches are per origin, and pull request previews share one: name them by scope so one build
// never removes another's.
const PREFIX = "rustgis-" + self.registration.scope + "-";
const CACHE = PREFIX + VERSION;

const urlOf = (path) => new URL(path, self.registration.scope).href;
const PAGE = urlOf("index.html");
// How long the page waits for the network before a cached copy is served instead.
const PAGE_TIMEOUT_MS = 4000;
const CACHED = new Set(SHELL.concat(EXTRA).map(urlOf));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await cache.addAll(SHELL.map((p) => new Request(urlOf(p), { cache: "reload" })));
      await Promise.all(
        EXTRA.map((p) => cache.add(new Request(urlOf(p), { cache: "reload" })).catch(() => {})),
      );
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "rustgis-update") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    // Only the app's own page: `?data=` and the other start-up options are read by the app from
    // the address bar, so every query string gets the same page.
    const page = req.url.split(/[?#]/)[0];
    if (page !== self.registration.scope && page !== PAGE) return;
    // The cached page stays the one this worker installed with: a newer deploy's page would name
    // files this cache does not hold. A connection that stalls instead of failing gets the cached
    // page after a few seconds, so the app still starts.
    const cached = () => caches.match(PAGE, { cacheName: CACHE });
    event.respondWith(
      new Promise((resolve) => {
        let done = false;
        const finish = (resp) => {
          if (!done && resp) {
            done = true;
            resolve(resp);
          }
        };
        const timer = setTimeout(() => cached().then(finish), PAGE_TIMEOUT_MS);
        fetch(req).then(
          (resp) => {
            clearTimeout(timer);
            finish(resp);
          },
          () => {
            clearTimeout(timer);
            cached().then((hit) => finish(hit || Response.error()));
          },
        );
      }),
    );
    return;
  }
  const key = req.url.split("#")[0];
  if (!CACHED.has(key)) return;
  event.respondWith(caches.match(key, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
});
