/* Shared state, API client, helpers and tiny UI parts. */
export const state = { user: null, config: {}, taxonomy: null, badges: { inbox: 0, admin: 0 }, installEvent: null };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method, credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, navigator.onLine ? "Couldn’t reach Hindsight. Please try again." : "You’re offline. Reconnect and try again.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; document.dispatchEvent(new CustomEvent("session-expired")); }
    throw new ApiError(res.status, (data && data.error) || "Something went wrong. Please try again.", data && data.field);
  }
  return data;
}

export async function loadTaxonomy() {
  if (!state.taxonomy) state.taxonomy = await api("GET", "/taxonomy");
  return state.taxonomy;
}
export async function refreshBadges() {
  if (!state.user) return;
  try { state.badges = await api("GET", "/badges"); renderTabs(); } catch { /* badges are optional */ }
}

/* ---------- Formatting ---------- */
export const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
export function dateShort(ts) { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
export function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  if (s < 86400 * 14) return Math.round(s / 86400) + " d ago";
  return dateShort(ts);
}

/* ---------- Icons ---------- */
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icon = {
  discover: P('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  saved: P('<path d="M6 4h12v17l-6-4-6 4z"/>'),
  savedFill: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z"/></svg>`,
  share: P('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  inbox: P('<path d="M4 5h16v11H9l-5 4z"/>'),
  me: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
  back: P('<path d="m15 5-7 7 7 7"/>'),
  eye: P('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P('<path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6C3.9 9.3 2 12 2 12s4 6 10 6c1.6 0 3-.4 4.3-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>')
};
export const logo = `<svg width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><circle class="m1" cx="10" cy="10" r="8.5"/><circle class="m2" cx="20" cy="10" r="8.5"/></svg>`;

/* ---------- Toast, dialog, tabs ---------- */
let toastTimer;
export function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

export function confirmDialog({ title, body, confirmLabel = "Confirm", danger = false, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p class="muted">${esc(body)}</p>
      <div class="row"><button class="btn ghost" value="no">${esc(cancelLabel)}</button><button class="btn ${danger ? "danger" : ""}" value="yes">${esc(confirmLabel)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
    d.showModal();
  });
}

const TABS = [
  ["discover", "Discover", icon.discover], ["saved", "Saved", icon.saved], ["share", "Share", icon.share],
  ["inbox", "Inbox", icon.inbox], ["me", "Profile", icon.me]
];
export function renderTabs(active) {
  const nav = $("#tabs");
  if (!nav) return;
  if (active !== undefined) nav.dataset.active = active;
  const cur = nav.dataset.active || "";
  const b = state.badges || {};
  nav.innerHTML = TABS.map(([id, label, svg]) => {
    const count = id === "inbox" ? b.inbox : id === "me" ? b.admin : 0;
    return `<a class="tab" href="#/${id}" ${cur === id ? 'aria-current="page"' : ""}>${svg}<span>${label}</span>${count ? `<span class="badge" aria-label="${count} new">${count > 9 ? "9+" : count}</span>` : ""}</a>`;
  }).join("");
}

/* ---------- Theme ---------- */
export function applyTheme() {
  let t = "system";
  try { t = localStorage.getItem("hs-theme") || "system"; } catch { /* ignore */ }
  if (t === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0F1816" : "#F1F4F3");
}
export function getTheme() { try { return localStorage.getItem("hs-theme") || "system"; } catch { return "system"; } }
export function setTheme(t) { try { localStorage.setItem("hs-theme", t); } catch { /* ignore */ } applyTheme(); }

/* ---------- Form helpers ---------- */
export function fieldError(form, field, message) {
  const el = form.querySelector(`[name="${field}"]`);
  const slot = form.querySelector(`[data-err="${field}"]`);
  if (el) { el.setAttribute("aria-invalid", "true"); }
  if (slot) { slot.textContent = message; slot.hidden = false; }
  return !!(el || slot);
}
export function clearErrors(form) {
  form.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
  form.querySelectorAll("[data-err]").forEach((e) => { e.textContent = ""; e.hidden = true; });
  const top = form.querySelector("[data-form-error]");
  if (top) { top.textContent = ""; top.hidden = true; }
}
export function showFormError(form, e) {
  if (e && e.field && fieldError(form, e.field, e.message)) {
    const el = form.querySelector(`[name="${e.field}"]`);
    if (el && el.focus) el.focus();
    return;
  }
  const top = form.querySelector("[data-form-error]");
  if (top) { top.textContent = e.message || "Something went wrong."; top.hidden = false; top.scrollIntoView({ block: "center" }); }
  else toast(e.message || "Something went wrong.");
}
export const errSlot = (name) => `<p class="err" data-err="${name}" role="alert" hidden></p>`;
export const formErrorBox = `<div class="banner bad" data-form-error role="alert" hidden></div>`;
export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; if (label) btn.textContent = label; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}

/* Shared story card used by Discover, Saved and My stories. */
export function cardHTML(s, opts = {}) {
  const why = opts.showWhy && s.match && (s.match.reason === "query-tags" || s.match.reason === "query-words" || s.match.reason === "topics")
    ? `<p class="why"><b>${s.match.reason === "topics" ? "Matches your interests" : "Why it matched"}</b>${
      s.match.tags.length ? esc(s.match.reason === "topics" ? s.match.tags.join(", ").toLowerCase() : "Shares: " + s.match.tags.join(", ").toLowerCase()) : "Uses words from your description"}</p>` : "";
  return `<article class="story-card" data-nav="#/story/${s.id}">
    <div class="card-top"><span class="pill tone-${s.tone}"><i></i>${esc(s.outcome)}</span>${s.isSample ? '<span class="eg">Example story</span>' : ""}</div>
    <h3><a href="#/story/${s.id}" style="color:inherit;text-decoration:none">${esc(s.title)}</a></h3>
    <p class="byline">${esc(s.author)}${s.who ? " · " + esc(s.who) : ""}</p>
    <p class="lede">${esc(s.lede)}</p>${why}
    <div class="card-foot"><span>${esc(s.whenLabel)}</span><span>Written ${esc(s.written)}</span><span class="ask${s.connect.open ? " on" : ""}">${s.connect.open ? "Takes questions" : "Story only"}</span>
    ${opts.save ? `<button class="iconbtn save-btn" data-action="toggle-save" data-id="${s.id}" aria-pressed="${!!s.saved}" aria-label="${s.saved ? "Remove from saved" : "Save story"}">${s.saved ? icon.savedFill : icon.saved}</button>` : ""}</div>
  </article>`;
}
