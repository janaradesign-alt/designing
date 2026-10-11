import { state, api, esc, $, $$, icon, toast, errSlot, formErrorBox, busy, loadTaxonomy, confirmDialog, getTheme, setTheme, dateShort, refreshBadges } from "./core.js";
import { route, ACTIONS, FORMS, go, refresh } from "./router.js";

const INTENT = { read: "Read and learn", share: "Share my story", both: "Read and share" };
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/* ---------- Profile ---------- */
route("/me", async () => {
  const u = state.user;
  const theme = getTheme();
  const canInstall = !standalone() && (state.installEvent || isIOS());
  return {
    title: "Profile", tab: "me",
    html: `<div class="stack-l">
      <div class="row" style="gap:14px"><div style="width:56px;height:56px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font:500 1.6rem var(--serif)" aria-hidden="true">${esc(u.displayName.trim().charAt(0).toUpperCase())}</div>
        <div><h1 class="h-sec">${esc(u.displayName)}</h1><p class="muted small">${esc(u.email)}</p></div></div>
      ${u.verifyRequired ? `<div class="banner warn"><div><strong>Confirm your email</strong><p class="small">Required to share stories and send questions.</p></div><button class="btn sm" data-action="resend-verify">Resend email</button></div>` : ""}
      <div class="stack-s"><h2 class="eyebrow">Your interests</h2>
        <div class="card stack-s"><p><strong>${esc(u.stage || "Stage not set")}</strong> · ${esc(INTENT[u.intent] || "")}</p>
          <div class="tags">${u.topics.length ? u.topics.map((t) => `<span class="tag">${esc(t)}</span>`).join("") : '<span class="muted small">No topics chosen yet.</span>'}</div>
          <div><a class="btn ghost sm" href="#/me/edit">Edit</a></div></div></div>
      <div class="stack-s"><h2 class="eyebrow">Appearance</h2>
        <div class="seg" role="group" aria-label="Appearance">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button data-action="theme" data-theme-value="${v}" aria-pressed="${theme === v}">${l}</button>`).join("")}</div></div>
      <div class="stack-s"><h2 class="eyebrow">Account</h2><div class="menu">
        <a class="menu-item" href="#/share"><span>My stories</span><span class="muted">›</span></a>
        ${canInstall ? `<button class="menu-item" data-action="install"><span>Install the app</span><span class="muted">›</span></button>` : ""}
        <a class="menu-item" href="#/me/password"><span>Change password</span><span class="muted">›</span></a>
        <button class="menu-item" data-action="export"><span>Download my data</span><span class="muted">JSON</span></button>
        ${u.role === "admin" ? `<a class="menu-item" href="#/admin"><span>Moderation</span><span class="muted">${state.badges.admin ? state.badges.admin + " to review" : "›"}</span></a>` : ""}</div></div>
      <div class="stack-s"><h2 class="eyebrow">About</h2><div class="menu">
        <a class="menu-item" href="#/guidelines"><span>Community guidelines</span><span class="muted">›</span></a>
        <a class="menu-item" href="#/terms"><span>Terms of use</span><span class="muted">›</span></a>
        <a class="menu-item" href="#/privacy"><span>Privacy policy</span><span class="muted">›</span></a></div></div>
      <div class="menu"><button class="menu-item" data-action="logout"><span>Log out</span></button><a class="menu-item danger" href="#/me/delete"><span>Delete account</span></a></div>
      <p class="hint" style="text-align:center">Hindsight · member since ${dateShort(u.createdAt)}</p></div>`
  };
}, { auth: "user" });

ACTIONS.theme = (el) => { setTheme(el.dataset.themeValue); $$('[data-action="theme"]').forEach((b) => b.setAttribute("aria-pressed", String(b === el))); };
ACTIONS.logout = async () => {
  try { await api("POST", "/auth/logout"); } catch { /* ignore */ }
  state.user = null; state.badges = { inbox: 0, admin: 0 };
  go("#/welcome");
};
ACTIONS["resend-verify"] = async (el) => {
  busy(el, true, "Sending…");
  try { await api("POST", "/auth/resend-verification"); toast("Confirmation email sent"); } catch (e) { toast(e.message); }
  busy(el, false);
};
ACTIONS.export = async () => {
  try {
    const res = await fetch("/api/me/export", { credentials: "same-origin" });
    if (!res.ok) throw new Error("Couldn’t prepare your data.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "hindsight-data.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Your data was downloaded");
  } catch (e) { toast(e.message); }
};

/* ---------- Edit interests ---------- */
route("/me/edit", async () => {
  const tax = await loadTaxonomy();
  const u = state.user;
  return {
    title: "Edit profile", back: "#/me", bare: true,
    html: `<form class="stack" data-form="edit-me" novalidate><h1 class="h-page">Your details</h1>${formErrorBox}
      <div class="field"><label for="dn">First name</label><input id="dn" name="displayName" type="text" maxlength="40" value="${esc(u.displayName)}" autocomplete="given-name">${errSlot("displayName")}</div>
      <div class="field"><label for="stg">Stage</label><select id="stg" name="stage"><option value="">Not set</option>${tax.stages.map((s) => `<option ${u.stage === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
      <div class="field"><span class="lbl">Topics <span class="hint">(up to five)</span></span><div class="chips" role="group" aria-label="Topics">${tax.tags.map((t) => `<button type="button" class="chip" data-action="me-topic" data-topic="${esc(t)}" aria-pressed="${u.topics.includes(t)}">${esc(t)}</button>`).join("")}</div></div>
      <fieldset class="stack-s"><legend class="lbl">How you use Hindsight</legend>${Object.entries(INTENT).map(([v, l]) => `<label class="opt"><input type="radio" name="intent" value="${v}" ${u.intent === v ? "checked" : ""}><span><strong>${l}</strong></span></label>`).join("")}</fieldset>
      <button class="btn block" type="submit">Save</button></form>`
  };
}, { auth: "user" });
ACTIONS["me-topic"] = (el) => {
  const on = el.getAttribute("aria-pressed") !== "true";
  if (on && $$('[data-action="me-topic"][aria-pressed="true"]').length >= 5) { toast("You can choose up to five."); return; }
  el.setAttribute("aria-pressed", String(on));
};
FORMS["edit-me"] = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  const topics = $$('[data-action="me-topic"][aria-pressed="true"]', form).map((b) => b.dataset.topic);
  const body = { displayName: f.displayName, topics };
  body.stage = f.stage || null;
  if (f.intent) body.intent = f.intent;
  const r = await api("PATCH", "/me", body);
  state.user = r.user; toast("Saved"); go("#/me");
};

/* ---------- Password and deletion ---------- */
route("/me/password", async () => ({
  title: "Change password", back: "#/me", bare: true,
  html: `<form class="stack" data-form="change-pw" novalidate><h1 class="h-page">Change password</h1>${formErrorBox}
    <div class="field"><label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>${errSlot("current")}</div>
    <div class="field"><label for="nxt">New password</label><input id="nxt" name="next" type="password" autocomplete="new-password" required><span class="hint">At least 10 characters. Other devices will be logged out.</span>${errSlot("next")}</div>
    <button class="btn block" type="submit">Update password</button></form>`
}), { auth: "user" });
FORMS["change-pw"] = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  await api("POST", "/me/password", { current: f.current, next: f.next });
  toast("Password updated"); go("#/me");
};

route("/me/delete", async () => ({
  title: "Delete account", back: "#/me", bare: true,
  html: `<form class="stack" data-form="delete-me" novalidate><h1 class="h-page">Delete your account</h1>
    <div class="banner bad"><p>This permanently removes your account, your stories, your saved stories and reflections, and the questions you’ve sent or received. It can’t be undone.</p></div>
    <p class="muted small">You can download a copy of your data first from Profile.</p>${formErrorBox}
    <div class="field"><label for="dpw">Enter your password to confirm</label><input id="dpw" name="password" type="password" autocomplete="current-password" required>${errSlot("password")}</div>
    <button class="btn danger block" type="submit">Delete my account</button></form>`
}), { auth: "user" });
FORMS["delete-me"] = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  const ok = await confirmDialog({ title: "Delete your account?", body: "Everything you’ve created in Hindsight will be removed.", confirmLabel: "Delete", danger: true });
  if (!ok) return;
  await api("DELETE", "/me", { password: f.password });
  state.user = null; state.badges = { inbox: 0, admin: 0 };
  toast("Your account was deleted");
  go("#/welcome");
};

/* ---------- Admin ---------- */
route("/admin", async () => {
  const o = await api("GET", "/admin/overview");
  const s = o.stats;
  const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
  const pending = o.pending.length ? `<div class="list">${o.pending.map((x) => `<div class="item">
      <div class="row between"><span class="pill st-pending">Waiting for review</span><span class="hint">${esc(x.stage)}</span></div>
      <h3>${esc(x.title)}</h3><p class="small muted">${esc(x.author)}${x.who ? " · " + esc(x.who) : ""}</p><p class="prose" style="font-size:1rem">${esc(x.lede)}</p>
      <div class="row"><a class="btn ghost sm" href="#/story/${x.id}">Read in full</a></div>
      <div class="field"><label for="n${x.id}">Note (required to reject)</label><textarea id="n${x.id}" maxlength="500" style="min-height:64px" placeholder="What should the contributor change?"></textarea></div>
      <div class="row"><button class="btn sm" data-action="approve" data-id="${x.id}">Approve</button><button class="btn ghost sm" data-action="reject" data-id="${x.id}">Reject with note</button></div></div>`).join("")}</div>`
    : `<div class="empty"><h3>Nothing to review</h3><p class="muted">New and edited stories appear here.</p></div>`;
  const reports = o.reports.length ? `<div class="list">${o.reports.map((r) => `<div class="item">
      <span class="pill st-rejected">${esc(r.reason)}</span><h3>${esc(r.storyTitle)}</h3>${r.details ? `<p class="small">${esc(r.details)}</p>` : ""}
      <div class="row"><a class="btn ghost sm" href="#/story/${r.storyId}">Read story</a></div>
      <div class="field"><label for="rn${r.id}">Note</label><textarea id="rn${r.id}" maxlength="500" style="min-height:64px"></textarea></div>
      <div class="row"><button class="btn ghost sm" data-action="report-dismiss" data-id="${r.id}">Dismiss</button><button class="btn danger sm" data-action="report-unpublish" data-id="${r.id}">Unpublish story</button></div></div>`).join("")}</div>`
    : `<div class="empty"><h3>No open reports</h3></div>`;
  return {
    title: "Moderation", back: "#/me", tab: "me",
    html: `<div class="stack-l"><h1 class="h-page">Moderation</h1>
      <div class="stats">${stat(s.users, "members")}${stat(s.published, "published")}${stat(s.pending, "to review")}${stat(s.questions, "questions")}${stat(s.answered, "answered")}${stat(s.openReports, "reports")}</div>
      <div class="stack"><h2 class="h-sec">Stories to review</h2>${pending}</div>
      <div class="stack"><h2 class="h-sec">Reports</h2>${reports}</div>
      ${s.samples ? `<div class="stack"><h2 class="h-sec">Example stories</h2><p class="muted small">${s.samples} written examples are visible to members and labeled as examples. Remove them once you have real stories.</p><div><button class="btn ghost sm" data-action="remove-samples">Remove example stories</button></div></div>` : ""}</div>`
  };
}, { auth: "admin" });

const review = async (id, decision, el) => {
  const note = $("#n" + id).value;
  busy(el, true);
  try { await api("POST", `/admin/stories/${id}/review`, { decision, note }); toast(decision === "approve" ? "Story published" : "Story sent back"); refreshBadges(); refresh(); }
  catch (e) { busy(el, false); toast(e.message); }
};
ACTIONS.approve = (el) => review(el.dataset.id, "approve", el);
ACTIONS.reject = (el) => review(el.dataset.id, "reject", el);
const resolve = async (id, action, el) => {
  busy(el, true);
  try { await api("POST", `/admin/reports/${id}/resolve`, { action, note: $("#rn" + id).value }); toast("Report resolved"); refreshBadges(); refresh(); }
  catch (e) { busy(el, false); toast(e.message); }
};
ACTIONS["report-dismiss"] = (el) => resolve(el.dataset.id, "dismiss", el);
ACTIONS["report-unpublish"] = (el) => resolve(el.dataset.id, "unpublish", el);
ACTIONS["remove-samples"] = async () => {
  const ok = await confirmDialog({ title: "Remove example stories?", body: "They’ll disappear for all members, along with any saves and questions on them.", confirmLabel: "Remove", danger: true });
  if (!ok) return;
  try { const r = await api("POST", "/admin/samples/remove"); toast(`${r.removed} example stories removed`); refresh(); } catch (e) { toast(e.message); }
};
