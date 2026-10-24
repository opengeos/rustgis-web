
const BASE = "https://cdn.jsdelivr.net/npm/geolibre-wasm@1.7.0";
let ready = null;
function tools() {
  if (!ready) {
    ready = (async () => {
      const mod = await import(`${BASE}/tools.mjs/+esm`);
      await mod.initTools(`${BASE}/geolibre-cli.wasm`);
      return mod;
    })();
    // A failed download can be retried.
    ready.catch(() => { ready = null; });
  }
  return ready;
}
// Listing the manifests runs the runner synchronously (seconds of a blocked page), so the list
// is kept in the browser's cache under the runner's versioned URL and read from there on later
// visits. The runner itself loads only when a tool runs.
// The suffix changes when RustGIS reads the list differently.
const MANIFESTS = `${BASE}/manifests.json?v=1`;
async function manifestCache() {
  try { return await caches.open("rustgis-geolibre"); } catch (_) { return null; }
}
export async function geolibre_manifests() {
  const cache = await manifestCache();
  try {
    const hit = cache && await cache.match(MANIFESTS);
    if (hit) {
      const text = await hit.text();
      const list = JSON.parse(text);
      if (Array.isArray(list) && list.length > 0 && typeof list[0]?.id === "string") return text;
    }
  } catch (_) {
    // A damaged entry is listed again below, and the put replaces it.
  }
  const t = await tools();
  const list = await t.listManifests();
  const text = JSON.stringify(list);
  // An empty list isn't kept (it would hide the tools on every later visit), and the lists of
  // earlier runner versions are dropped.
  try {
    if (cache && list.length > 0) {
      await cache.put(MANIFESTS, new Response(text, { headers: { "content-type": "application/json" } }));
      for (const old of await cache.keys()) {
        if (old.url !== MANIFESTS) await cache.delete(old);
      }
    }
  } catch (e) {
    console.warn("RustGIS couldn't keep the GeoLibre tool list; it will be listed again next visit", e);
  }
  return text;
}
export async function geolibre_run(tool, argv, names, datas) {
  const t = await tools();
  const input = {};
  for (let i = 0; i < names.length; i++) input[names[i]] = datas[i];
  const r = await t.runTool(tool, { args: argv, input });
  const out = Object.entries(r.files);
  return { exitCode: r.exitCode, stdout: r.stdout, names: out.map((e) => e[0]), datas: out.map((e) => e[1]) };
}
