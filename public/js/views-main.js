import { state, api, esc, $, $$, icon, toast, errSlot, formErrorBox, busy, loadTaxonomy, cardHTML, refreshBadges, dateShort, confirmDialog } from "./core.js";
import { route, ACTIONS, FORMS, go, refresh, parseHash } from "./router.js";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function installBanner() {
  let dismissed = false;
  try { dismissed = localStorage.getItem("hs-install-dismissed") === "1"; } catch { /* ignore */ }
  if (dismissed || standalone()) return "";
  if (state.installEvent) {
    return `<div class="banner"><div><strong>Install Hindsight</strong><p class="small">Add it to your home screen for quick, full-screen access.</p></div><div class="row"><button class="btn sm" data-action="install">Install</button><button class="btn sm quiet" data-action="dismiss-install">Not now</button></div></div>`;
  }
  if (isIOS()) {
    return `<div class="banner"><div><strong>Add Hindsight to your home screen</strong><p class="small">In Safari, tap the Share button, then “Add to Home Screen.”</p></div><button class="btn sm quiet" data-action="dismiss-install">Dismiss</button></div>`;
  }
  return "";
}

/* ---------- Discover ---------- */
const EXAMPLES = ["I’m thinking about leaving my PhD", "Academia or industry?", "Feeling like an imposter", "Changing careers", "My advisor is difficult", "Starting a business"];

route("/discover", async ({ query }) => {
  const tax = await loadTaxonomy();
  const q = (query.get("q") || "").slice(0, 400);
  const stage = query.get("stage") || "";
  const open = query.get("open") === "1";
  const params = new URLSearchParams();
  if (q) params.set("q", q); if (stage) params.set("stage", stage); if (open) params.set("open", "1");
  const data = await api("GET", "/stories?" + params.toString());
  const heading = q
    ? `${data.stories.length} ${data.stories.length === 1 ? "experience matches" : "experiences match"} what you described`
    : data.personalized ? "For you" : "All stories";
  let body;
  if (data.stories.length) {
    body = `<div class="list">${data.stories.map((s) => cardHTML(s, { showWhy: true, save: true })).join("")}</div>`;
  } else if (q || stage || open) {
    body = `<div class="empty"><h3>No close matches yet</h3><p class="muted">Hindsight only shows stories that share something with your situation. Try fewer words, another stage, or turn off filters.</p><a class="btn ghost sm" href="#/discover">Clear search and filters</a></div>`;
  } else {
    body = `<div class="empty"><h3>No stories yet</h3><p class="muted">Stories appear here once they’ve been reviewed. You could be the first to share one.</p><a class="btn sm" href="#/share">Share a story</a></div>`;
  }
  return {
    title: "Discover", tab: "discover", brand: true,
    html: `<div class="stack-l">
      ${installBanner()}
      <div class="stack"><h1 class="h-page">Someone’s <em style="color:var(--accent)">been</em> where you are.</h1>
      <form class="card stack" data-form="search" novalidate>
        <div class="field"><label for="q">What are you navigating?</label>
        <textarea id="q" name="q" rows="2" maxlength="400" style="border:0;padding:4px;min-height:72px;background:transparent;resize:none;font:400 1.1rem/1.45 var(--serif)" placeholder="For example: I’m thinking about leaving my PhD, and my advisor is part of the reason.">${esc(q)}</textarea></div>
        <input type="hidden" name="stage" value="${esc(stage)}"><input type="hidden" name="open" value="${open ? "1" : ""}">
        <button class="btn block" type="submit">Find experiences</button></form>
      ${q ? "" : `<div class="scroll-row" role="group" aria-label="Examples">${EXAMPLES.map((e) => `<button class="chip" data-action="example" data-q="${esc(e)}">${esc(e)}</button>`).join("")}</div>`}</div>
      <div class="stack">
        <div class="scroll-row" role="group" aria-label="Filters">
          <button class="chip" data-action="filter" data-key="stage" data-value="" aria-pressed="${!stage}">All stages</button>
          ${tax.stages.map((g) => `<button class="chip" data-action="filter" data-key="stage" data-value="${esc(g)}" aria-pressed="${stage === g}">${esc(g)}</button>`).join("")}
          <button class="chip" data-action="filter" data-key="open" data-value="${open ? "" : "1"}" aria-pressed="${open}">Takes questions</button>
        </div>
        <div class="row between"><h2 class="h-sec">${esc(heading)}</h2>${q ? '<a class="btn ghost sm" href="#/discover">Clear</a>' : ""}</div>
        ${body}
      </div></div>`
  };
}, { auth: "user" });

FORMS.search = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  const p = new URLSearchParams();
  if (f.q && f.q.trim()) p.set("q", f.q.trim());
  if (f.stage) p.set("stage", f.stage);
  if (f.open) p.set("open", "1");
  go("#/discover" + (p.toString() ? "?" + p : ""));
};
ACTIONS.example = (el) => go("#/discover?q=" + encodeURIComponent(el.dataset.q));
ACTIONS.filter = (el) => {
  const { query } = parseHash();
  if (el.dataset.value) query.set(el.dataset.key, el.dataset.value); else query.delete(el.dataset.key);
  go("#/discover" + (query.toString() ? "?" + query : ""));
};

/* ---------- Saving (cards and story page) ---------- */
ACTIONS["toggle-save"] = async (el, e) => {
  e.stopPropagation();
  const id = el.dataset.id, on = el.getAttribute("aria-pressed") !== "true";
  el.disabled = true;
  try {
    await api(on ? "PUT" : "DELETE", `/stories/${id}/save`);
    el.setAttribute("aria-pressed", String(on));
    if (el.dataset.text) el.textContent = on ? "Saved ✓" : "Save story";
    else { el.innerHTML = on ? icon.savedFill : icon.saved; el.setAttribute("aria-label", on ? "Remove from saved" : "Save story"); }
    toast(on ? "Saved" : "Removed from saved");
    if (parseHash().path === "/saved" && !on) refresh();
  } catch (err) { toast(err.message); }
  el.disabled = false;
};

/* ---------- Story ---------- */
export function storyBodyHTML(s) {
  const list = (a) => a.map((x) => `<li>${esc(x)}</li>`).join("");
  return `<header class="s-head stack">
      <div><span class="pill tone-${s.tone}"><i></i>${esc(s.outcome)}</span></div>
      <h1>${esc(s.title)}</h1>
      <p class="muted"><strong style="color:var(--ink)">${esc(s.author)}</strong>${s.who ? " · " + esc(s.who) : ""}</p>
      <div class="facts"><span>${esc(s.whenLabel)}</span><span>Written ${esc(s.written)}</span><span>${s.identityMode === "first_name" ? "First name shared" : "Anonymous"}</span></div>
      <div class="tags">${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    </header>
    <section class="sec"><h2>The situation</h2><p class="prose">${esc(s.situation)}</p></section>
    <section class="sec"><h2>What I tried</h2><ul class="steps">${list(s.tried)}</ul></section>
    <section class="sec"><h2>What happened</h2><p class="prose">${esc(s.happened)}</p></section>
    <section class="sec"><h2>The trade-offs</h2><div class="two"><div><h3>What it gave me</h3><ul>${list(s.gave)}</ul></div><div><h3>What it cost me</h3><ul>${list(s.cost)}</ul></div></div></section>
    <section class="sec"><h2>Then and now</h2><div class="pairs">${s.pairs.map((p) => `<div><div class="pair-label">${esc(p.label)}</div><div class="pair-row">
      <div class="cell then"><span class="when">Then · ${esc(s.thenTag)}</span><p>${esc(p.then)}</p></div>
      <div class="cell now"><span class="when">Now · ${esc(s.written)}</span><p>${esc(p.now)}</p></div></div></div>`).join("")}</div></section>
    ${s.unresolved ? `<section class="sec"><h2>Still unresolved</h2><div class="open-q"><p>${esc(s.unresolved)}</p></div></section>` : ""}`;
}

function bounds(c) {
  return `<dl class="bounds"><dt>Replies</dt><dd>${esc(c.window)}</dd><dt>Format</dt><dd>${esc(c.format)}</dd>${c.topics.length ? `<dt>Welcome</dt><dd>${c.topics.map(esc).join(", ")}</dd>` : ""}${c.off ? `<dt>Off limits</dt><dd>${esc(c.off)}</dd>` : ""}</dl>`;
}
function connectHTML(s) {
  const c = s.connect;
  const sample = s.isSample ? `<div class="banner warn">Example story. Questions are saved, but no one will reply.</div>` : "";
  if (s.mine) {
    return `<h2>Questions on your story</h2><span class="status${c.open ? "" : " off"}">${c.open ? "Open to questions" : "Not taking questions"}</span>${c.open ? bounds(c) : ""}
      <p class="muted small">Questions from readers appear in your Inbox. You choose whether to reply.</p><div class="row"><a class="btn sm" href="#/inbox">Open Inbox</a><a class="btn ghost sm" href="#/share/${s.id}/settings">Question settings</a></div>`;
  }
  if (!c.open) {
    const t = s.tags[0] ? `#/discover?q=${encodeURIComponent(s.tags[0])}` : "#/discover";
    return `<h2>Story only</h2><span class="status off">Not taking questions</span>
      <p class="muted">${esc(s.author)} shared this story on its own, and that’s her choice. It stands without a conversation.</p><a class="btn ghost sm" href="${t}" style="align-self:flex-start">Find similar stories</a>`;
  }
  const head = `<h2>Ask ${esc(s.author === "Anonymous" ? "the contributor" : s.author)}</h2><span class="status">Open to questions</span>${bounds(c)}${sample}`;
  const q = s.question;
  if (q && q.status === "pending") {
    return `${head}<div class="reply"><strong>Question sent · ${dateShort(q.createdAt)}</strong><blockquote class="quote">${esc(q.text)}</blockquote>
      <span class="hint">Shown as ${q.ident === "first_name" ? "your first name" : "anonymous"}. She chooses whether to reply, usually ${esc(c.window)}. You can keep reading in the meantime.</span>
      <div><button class="btn ghost sm" data-action="withdraw-q" data-id="${q.id}">Withdraw question</button></div></div>`;
  }
  if (q && q.status === "answered") {
    return `${head}<blockquote class="quote then">${esc(q.text)}</blockquote><div class="reply"><strong>${esc(s.author)} replied · ${dateShort(q.repliedAt)}</strong><p class="prose" style="font-size:1.05rem">${esc(q.reply)}</p></div>`;
  }
  const declinedNote = q && q.status === "declined" ? `<div class="banner warn">She chose not to answer your last question. That’s her right, and the story is still here to learn from.</div>` : "";
  if (!s.canAsk) return `${head}${declinedNote}<p class="muted">This contributor isn’t available for questions from you right now.</p>`;
  if (s.askLimitReached) return `${head}${declinedNote}<p class="muted">You’ve sent several questions today. Please come back tomorrow so contributors aren’t overwhelmed.</p>`;
  return `${head}${declinedNote}<form class="stack" data-form="ask" data-id="${s.id}" novalidate>${formErrorBox}
    <div class="field"><label for="qtext">Your question</label>
    <textarea id="qtext" name="text" maxlength="500" placeholder="Ask about something the story didn’t cover. Be specific about what you’d like to know."></textarea>
    <div class="counter"><span id="qcount">0</span>/500</div>${errSlot("text")}</div>
    <div class="field"><label for="ident">Show her</label><select id="ident" name="ident"><option value="anonymous">Anonymous, my name stays hidden</option><option value="first_name">My first name</option></select></div>
    <button class="btn block" id="sendQ" type="submit" disabled>Send question</button>
    <p class="hint">She may not reply, and that’s okay. Please don’t share contact details or identify other people.</p></form>`;
}

route("/story/:id", async ({ params }) => {
  const tax = await loadTaxonomy();
  const { story: s } = await api("GET", "/stories/" + params.id);
  if (s.question && (s.question.status === "answered" || s.question.status === "declined")) {
    api("POST", `/questions/${s.question.id}/seen`).then(refreshBadges).catch(() => {});
  }
  const statusBanner = s.mine && s.status !== "published"
    ? `<div class="banner ${s.status === "rejected" ? "bad" : "warn"}"><div><strong>${s.status === "pending" ? "Waiting for review" : "Needs a change"}</strong><p class="small">${s.status === "pending" ? "Only you can see this story until it’s approved." : esc(s.moderationNote || "Please edit it and send it back for review.")}</p></div>${s.status === "rejected" ? `<a class="btn sm" href="#/share/${s.id}/edit">Edit</a>` : ""}</div>` : "";
  const sampleBanner = s.isSample ? `<div class="banner warn"><p class="small"><strong>Example story.</strong> This was written to show how Hindsight works. It isn’t a real person’s account.</p></div>` : "";
  const refl = s.reflection;
  const contrast = s.contrast ? `<div class="contrast"><strong>See another perspective</strong><span class="muted">${esc(s.contrast.line)}</span><a class="btn ghost sm" href="#/story/${s.contrast.id}">Read ${esc(s.contrast.author === "Anonymous" ? "this story" : s.contrast.author + "’s story")}</a></div>` : "";
  const reportBlock = s.mine || s.status !== "published" ? "" : s.reported
    ? `<p class="hint">Report received. A moderator will review this story.</p>`
    : `<div class="stack-s"><button class="linkbtn small" style="align-self:flex-start;color:var(--ink-2)" data-action="toggle-report">Report this story</button>
      <form class="card stack" data-form="report" data-id="${s.id}" hidden novalidate>${formErrorBox}
      <fieldset class="stack-s"><legend class="lbl">What’s the concern?</legend>${tax.reportReasons.map((r, i) => `<label class="check"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? "checked" : ""}><span>${esc(r)}</span></label>`).join("")}</fieldset>
      <div class="field"><label for="rdet">Details <span class="hint">(optional)</span></label><textarea id="rdet" name="details" maxlength="1000" style="min-height:72px"></textarea></div>
      <div><button class="btn sm" type="submit">Send report</button></div></form></div>`;
  return {
    title: "Story", back: "history", tab: "discover",
    html: `<div class="stack-l">
      ${statusBanner}${sampleBanner}
      <div class="jump" role="navigation" aria-label="Sections"><button data-action="jump" data-target="understand">Story</button><button data-action="jump" data-target="connect">Connect</button><button data-action="jump" data-target="reflect">Reflect</button>
        <button class="btn ghost sm" style="margin-left:auto;min-height:34px" data-action="toggle-save" data-text="1" data-id="${s.id}" aria-pressed="${s.saved}">${s.saved ? "Saved ✓" : "Save story"}</button></div>
      <div class="stack-l" id="understand">${storyBodyHTML(s)}</div>
      ${reportBlock}
      <section class="sec" id="connect"><div class="panel">${connectHTML(s)}</div></section>
      <section class="sec" id="reflect"><div class="panel"><h2>What stays with you?</h2>
        <p class="muted small">Hindsight shows what happened for someone else. What it means for your own decision is yours to work out.</p>
        <div class="chips wrapnone" role="group" aria-label="Reactions">${tax.picks.map((p) => `<button class="chip" data-action="pick" data-pick="${esc(p)}" aria-pressed="${refl.picks.includes(p)}">${esc(p)}</button>`).join("")}</div>
        <div class="field"><label for="rtext">In your own words</label><textarea id="rtext" maxlength="2000" placeholder="What looks different about your own options now?">${esc(refl.text)}</textarea></div>
        <div class="row"><button class="btn" data-action="save-refl" data-id="${s.id}">Save reflection</button></div>
        ${contrast}</div></section>
    </div>`,
    after(root) {
      const t = $("#qtext", root), b = $("#sendQ", root), c = $("#qcount", root);
      if (t) t.addEventListener("input", () => { c.textContent = t.value.length; b.disabled = t.value.trim().length < 10; });
    }
  };
}, { auth: "user" });

ACTIONS.jump = (el) => { const t = document.getElementById(el.dataset.target); if (t) t.scrollIntoView(); };
ACTIONS.pick = (el) => el.setAttribute("aria-pressed", String(el.getAttribute("aria-pressed") !== "true"));
ACTIONS["save-refl"] = async (el) => {
  const picks = $$('[data-action="pick"][aria-pressed="true"]').map((x) => x.dataset.pick);
  busy(el, true, "Saving…");
  try {
    await api("PUT", `/stories/${el.dataset.id}/reflection`, { picks, text: $("#rtext").value });
    const sb = $('[data-action="toggle-save"][data-text]');
    if (sb) { sb.setAttribute("aria-pressed", "true"); sb.textContent = "Saved ✓"; }
    toast("Reflection saved");
  } catch (e) { toast(e.message); }
  busy(el, false);
};
ACTIONS["toggle-report"] = (el) => { const f = $('[data-form="report"]'); f.hidden = !f.hidden; if (!f.hidden) f.scrollIntoView({ block: "center" }); };
FORMS.report = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  await api("POST", `/stories/${form.dataset.id}/report`, { reason: f.reason, details: f.details });
  toast("Report sent. Thank you.");
  refresh();
};
FORMS.ask = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  await api("POST", `/stories/${form.dataset.id}/questions`, { text: f.text, ident: f.ident });
  toast("Question sent");
  refreshBadges();
  refresh();
};
ACTIONS["withdraw-q"] = async (el) => {
  const ok = await confirmDialog({ title: "Withdraw this question?", body: "She won’t see it, and you can send a different one.", confirmLabel: "Withdraw" });
  if (!ok) return;
  try { await api("POST", `/questions/${el.dataset.id}/withdraw`); toast("Question withdrawn"); refresh(); } catch (e) { toast(e.message); }
};

/* ---------- Saved ---------- */
route("/saved", async () => {
  const { stories } = await api("GET", "/saved");
  const body = stories.length
    ? `<div class="list">${stories.map((s) => `<div class="stack-s">${cardHTML(s, { save: true })}
        ${s.reflection && (s.reflection.text || s.reflection.picks.length) ? `<div class="item"><span class="eyebrow">Your reflection</span>${s.reflection.picks.length ? `<p class="small muted">${s.reflection.picks.map(esc).join(" · ")}</p>` : ""}${s.reflection.text ? `<blockquote class="quote">${esc(s.reflection.text)}</blockquote>` : ""}</div>` : ""}
        ${s.questionStatus ? `<p class="hint">${s.questionStatus === "pending" ? "Your question is waiting for a reply." : s.questionStatus === "answered" ? "Your question was answered." : "Your question wasn’t answered."} <a href="#/inbox">Open Inbox</a></p>` : ""}</div>`).join("")}</div>`
    : `<div class="empty"><h3>Nothing saved yet</h3><p class="muted">Save a story to keep it here with your reflections and any question you’ve sent.</p><a class="btn sm" href="#/discover">Browse stories</a></div>`;
  return { title: "Saved", tab: "saved", html: `<div class="stack"><h1 class="h-page">Saved</h1>${body}</div>` };
}, { auth: "user" });
