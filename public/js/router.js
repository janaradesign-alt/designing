/* Minimal hash router with registries for click actions and form handlers. */
export const routes = [];
export const ACTIONS = {};
export const FORMS = {};

export function route(pattern, handler, meta = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_m, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ re, keys, handler, meta });
}
export function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const i = raw.indexOf("?");
  const path = i >= 0 ? raw.slice(0, i) : raw;
  const query = new URLSearchParams(i >= 0 ? raw.slice(i + 1) : "");
  return { path: path || "/", query };
}
export function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}
export function go(hash, replace = false) {
  if (replace) history.replaceState(null, "", hash); else location.hash = hash;
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
export const refresh = () => window.dispatchEvent(new HashChangeEvent("hashchange"));
