import { state, api, $, esc, icon, logo, toast, refreshBadges, renderTabs, applyTheme, fieldError, clearErrors, showFormError, busy } from "./core.js";
import { routes, match, parseHash, go, ACTIONS, FORMS, route } from "./router.js";
import "./views-auth.js";
import "./views-main.js";
import "./views-share.js";
import "./views-inbox.js";
import "./views-me.js";

applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

const view = () => $("#view");
let renderId = 0, lastPath = "", aborter = null;
const ICON_BACK = icon.back;

function setBar({ title, back, brand, hideBar }) {
  const bar = $("#appbar");
  bar.hidden = !!hideBar;
  const left = back
    ? `<button class="iconbtn" data-action="back" data-back="${esc(back)}" aria-label="Back">${ICON_BACK}</button>` : `<span></span>`;
  const mid = brand ? `<h1 class="brand" style="font:500 1.3rem/1 var(--serif)">${logo}<span>Hindsight</span></h1>` : `<h1>${esc(title || "")}</h1>`;
  bar.innerHTML = `${left}${mid}<span></span>`;
  document.title = title && !brand ? `${title} · Hindsight` : "Hindsight";
}

let navs = 0;
window.addEventListener("hashchange", (e) => { if (e.oldURL !== e.newURL) navs++; });
ACTIONS.back = (el) => {
  const b = el.dataset.back;
  if (b === "history" && navs > 0) { navs--; history.back(); return; }
  if (b === "history") { go(state.user ? "#/discover" : "#/welcome"); return; }
  go(b);
};
ACTIONS.install = async () => {
  const ev = state.installEvent;
  if (ev) { ev.prompt(); try { await ev.userChoice; } catch { /* ignore */ } state.installEvent = null; go(location.hash, true); return; }
  toast("In Safari, tap Share, then “Add to Home Screen.”");
};
ACTIONS["dismiss-install"] = () => { try { localStorage.setItem("hs-install-dismissed", "1"); } catch { /* ignore */ } go(location.hash, true); };

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvent = e; if (parseHash().path === "/discover") go(location.hash, true); });
window.addEventListener("appinstalled", () => { state.installEvent = null; toast("Hindsight was installed"); });
window.addEventListener("offline", () => { $("#offline").hidden = false; });
window.addEventListener("online", () => { $("#offline").hidden = true; });
document.addEventListener("session-expired", () => { toast("Your session ended. Please log in again."); go("#/login"); });

/* ---------- Guarding and rendering ---------- */
function guard(r) {
  const a = r.meta.auth || "user";
  const u = state.user;
  if (a === "public") return null;
  if (a === "guest") return u ? (u.onboarded ? "#/discover" : "#/onboarding") : null;
  if (!u) { if (a !== "guest") { try { sessionStorage.setItem("hs-next", location.hash); } catch { /* ignore */ } } return "#/welcome"; }
  if (a === "onboarding") return u.onboarded ? "#/discover" : null;
  if (!u.onboarded) return "#/onboarding";
  if (a === "admin" && u.role !== "admin") return "#/discover";
  return null;
}

async function render() {
  const id = ++renderId;
  if (aborter) aborter.abort();
  aborter = new AbortController();
  const { path, query } = parseHash();
  const m = match(path === "/" ? (state.user ? "/discover" : "/welcome") : path);
  if (!m) { go(state.user ? "#/discover" : "#/welcome", true); return; }
  const redirect = guard(m.route);
  if (redirect) { go(redirect, true); return; }

  const samePage = path === lastPath;
  const keepY = window.scrollY;
  const v = view();
  if (!samePage) v.innerHTML = `<div class="loading" aria-busy="true"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
  let out;
  try {
    out = await m.route.handler({ params: m.params, query, path });
  } catch (e) {
    if (id !== renderId) return;
    if (e && e.status === 401) { go("#/welcome", true); return; }
    out = { title: "Oops", back: "history", html: `<div class="empty"><h3>${e && e.status === 404 ? "We couldn’t find that" : "Something went wrong"}</h3><p class="muted">${esc((e && e.message) || "Please try again.")}</p><a class="btn sm" href="#/${state.user ? "discover" : "welcome"}">Go home</a></div>`, tab: "discover" };
  }
  if (id !== renderId) return; // a newer navigation took over
  document.body.classList.toggle("bare", !!out.bare || !state.user || !state.user.onboarded);
  setBar(out);
  renderTabs(out.tab || "");
  v.innerHTML = out.html;
  lastPath = path;
  if (out.after) out.after(v, aborter.signal);
  if (samePage) window.scrollTo(0, keepY); else { window.scrollTo(0, 0); v.focus({ preventScroll: true }); }
}
window.addEventListener("hashchange", render);

/* ---------- Event delegation ---------- */
document.addEventListener("click", (e) => {
  const act = e.target.closest("[data-action]");
  if (act) {
    const fn = ACTIONS[act.dataset.action];
    if (fn) {
      if (act.tagName === "A") e.preventDefault();
      Promise.resolve(fn(act, e)).catch((err) => toast(err.message || "Something went wrong."));
      return;
    }
  }
  const card = e.target.closest("[data-nav]");
  if (card && !e.target.closest("a, button, input, select, textarea")) go(card.dataset.nav);
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const fn = FORMS[form.dataset.form];
  if (!fn) return;
  clearErrors(form);
  const btn = form.querySelector('button[type="submit"]');
  busy(btn, true, "Please wait…");
  try { await fn(form, btn); } catch (err) { showFormError(form, err); }
  if (btn && btn.isConnected) busy(btn, false);
});

/* ---------- Boot ---------- */
async function boot() {
  try {
    const r = await api("GET", "/me");
    state.user = r.user; state.config = r.config || {};
  } catch { /* offline: show the welcome screen */ }
  $("#shell").hidden = false;
  $("#boot").remove();
  if (!location.hash || location.hash === "#" || location.hash === "#/") history.replaceState(null, "", state.user ? "#/discover" : "#/welcome");
  if (!navigator.onLine) $("#offline").hidden = false;
  await render();
  if (state.user) {
    refreshBadges();
    setInterval(() => { if (document.visibilityState === "visible") refreshBadges(); }, 60000);
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.user) refreshBadges(); });
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}
