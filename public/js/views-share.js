import { state, api, esc, $, $$, toast, errSlot, formErrorBox, showFormError, busy, loadTaxonomy, confirmDialog, dateShort } from "./core.js";
import { route, ACTIONS, FORMS, go, refresh } from "./router.js";
import { storyBodyHTML } from "./views-main.js";

const STATUS = {
  pending: ["st-pending", "Waiting for review"], published: ["st-published", "Published"], rejected: ["st-rejected", "Needs a change"]
};
const TONES = [
  ["positive", "Mostly good", "I’m glad with how it turned out."],
  ["mixed", "Mixed", "There were gains and real costs."],
  ["unresolved", "Still unresolved", "I’m still working it out."]
];

/* ---------- Share tab: my stories ---------- */
route("/share", async () => {
  const { stories } = await api("GET", "/my/stories");
  const verify = state.user.verifyRequired
    ? `<div class="banner warn"><div><strong>Confirm your email to share</strong><p class="small">We sent a link to ${esc(state.user.email)}. You can resend it from Profile.</p></div></div>` : "";
  const list = stories.length
    ? `<div class="list">${stories.map((s) => {
      const [cls, label] = STATUS[s.status] || STATUS.pending;
      return `<div class="item"><div class="row between"><span class="pill ${cls}">${label}</span><span class="hint">${dateShort(s.updatedAt)}</span></div>
        <h3>${esc(s.title)}</h3>
        ${s.status === "rejected" && s.moderationNote ? `<p class="banner bad small">${esc(s.moderationNote)}</p>` : ""}
        ${s.waitingQuestions ? `<p class="small"><a href="#/inbox"><strong>${s.waitingQuestions}</strong> ${s.waitingQuestions === 1 ? "question is" : "questions are"} waiting for your reply</a></p>` : ""}
        <div class="row"><a class="btn sm ghost" href="#/story/${s.id}">View</a><a class="btn sm ghost" href="#/share/${s.id}/edit">Edit</a>
        ${s.status === "published" ? `<a class="btn sm ghost" href="#/share/${s.id}/settings">Question settings</a>` : ""}
        <button class="btn sm quiet" style="color:var(--danger)" data-action="delete-story" data-id="${s.id}">Delete</button></div></div>`;
    }).join("")}</div>` : "";
  return {
    title: "Share", tab: "share",
    html: `<div class="stack-l">${verify}
      <div class="stack"><h1 class="h-page">Share what you’ve learned</h1>
        <p class="lead">A good story says what you feared, what you tried, and what you believe now. Setbacks and unresolved endings belong here too. You decide how you’re identified and whether anyone can ask you questions.</p>
        <a class="btn block" href="#/share/new">${stories.length ? "Share another story" : "Share a story"}</a></div>
      ${stories.length ? `<div class="stack"><h2 class="h-sec">Your stories</h2>${list}</div>` : ""}</div>`
  };
}, { auth: "user" });

ACTIONS["delete-story"] = async (el) => {
  const ok = await confirmDialog({ title: "Delete this story?", body: "It will be removed along with any questions on it. This can’t be undone.", confirmLabel: "Delete", danger: true });
  if (!ok) return;
  try { await api("DELETE", "/stories/" + el.dataset.id); toast("Story deleted"); refresh(); } catch (e) { toast(e.message); }
};

/* ---------- Story form ---------- */
const STEP_TITLES = ["The decision", "Your situation", "What happened", "Then and now", "Privacy and contact", "Review"];
const FIELD_STEP = {
  title: 0, lede: 0, stage: 0, tags: 0, outcome: 0, tone: 0,
  whenLabel: 1, thenTag: 1, written: 1, situation: 1, who: 1,
  tried: 2, happened: 2, gave: 2, cost: 2, pairs: 3, unresolved: 3,
  pledge: 4, identityMode: 4, replyWindow: 4, replyFormat: 4, topicsWelcome: 4, offLimits: 4
};
const blank = () => ({
  title: "", lede: "", stage: "", tags: [], outcome: "", tone: "", whenLabel: "", thenTag: "", written: "", who: "", situation: "",
  triedText: "", happened: "", gaveText: "", costText: "", pairs: [{ label: "", then: "", now: "" }], unresolved: "",
  identityMode: "anonymous", pledge: false, allowQuestions: true, replyWindow: "about 2 weeks", replyFormat: "Written replies only", topicsWelcomeText: "", offLimits: ""
});
let F = null; // { key, id, step, data, error, restored }
const draftKey = (id) => `hs-draft-${state.user.id}-${id || "new"}`;
let saveTimer;
function saveDraft() {
  if (!F || F.id) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(draftKey(null), JSON.stringify({ data: F.data, step: F.step })); } catch { /* ignore */ } }, 300);
}
const lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);
function payload(d) {
  return {
    title: d.title, lede: d.lede, stage: d.stage, tags: d.tags, outcome: d.outcome, tone: d.tone, who: d.who, identityMode: d.identityMode,
    whenLabel: d.whenLabel, thenTag: d.thenTag, written: d.written, situation: d.situation, tried: lines(d.triedText), happened: d.happened,
    gave: lines(d.gaveText), cost: lines(d.costText),
    pairs: d.pairs.filter((p) => p.then.trim() || p.now.trim()).map((p) => ({ label: p.label.trim(), then: p.then.trim(), now: p.now.trim() })),
    unresolved: d.unresolved, pledge: d.pledge, allowQuestions: d.allowQuestions, replyWindow: d.replyWindow, replyFormat: d.replyFormat,
    topicsWelcome: String(d.topicsWelcomeText || "").split(",").map((x) => x.trim()).filter(Boolean), offLimits: d.offLimits
  };
}
function fromStory(s) {
  return {
    ...blank(), title: s.title, lede: s.lede, stage: s.stage, tags: s.tags, outcome: s.outcome, tone: s.tone, whenLabel: s.whenLabel, thenTag: s.thenTag,
    written: s.written, who: s.who, situation: s.situation, triedText: s.tried.join("\n"), happened: s.happened, gaveText: s.gave.join("\n"), costText: s.cost.join("\n"),
    pairs: s.pairs.length ? s.pairs.map((p) => ({ ...p })) : [{ label: "", then: "", now: "" }], unresolved: s.unresolved,
    identityMode: s.identityMode, pledge: false, allowQuestions: s.connect.open, replyWindow: s.connect.window, replyFormat: s.connect.format,
    topicsWelcomeText: s.connect.topics.join(", "), offLimits: s.connect.off
  };
}

/* Client-side checks mirror the server so people get quick feedback. The server stays the authority. */
function validate(step, d) {
  const L = (t) => String(t || "").trim().length;
  if (step === 0) {
    if (L(d.title) < 8) return ["title", "Give your story a title of at least 8 characters."];
    if (L(d.lede) < 20) return ["lede", "Add a one-sentence summary of at least 20 characters."];
    if (!d.stage) return ["stage", "Choose the stage you were in."];
    if (!d.tags.length) return ["tags", "Choose at least one topic."];
    if (L(d.outcome) < 3) return ["outcome", "Describe how it turned out in a few words."];
    if (!d.tone) return ["tone", "Choose how you feel about the outcome."];
  }
  if (step === 1) {
    if (L(d.whenLabel) < 3) return ["whenLabel", "Say when you decided, for example “Decided in year 3 of 6”."];
    if (L(d.thenTag) < 2) return ["thenTag", "Add a short label for that time, for example “Year 3”."];
    if (!d.written) return ["written", "Choose how long ago this was."];
    if (L(d.situation) < 40) return ["situation", "Describe the situation in at least 40 characters."];
  }
  if (step === 2) {
    if (!lines(d.triedText).length) return ["tried", "List at least one thing you tried."];
    if (L(d.happened) < 40) return ["happened", "Describe what happened in at least 40 characters."];
    if (!lines(d.gaveText).length) return ["gave", "List at least one thing it gave you."];
    if (!lines(d.costText).length) return ["cost", "List at least one thing it cost you."];
  }
  if (step === 3) {
    const ps = d.pairs.filter((p) => p.then.trim() || p.now.trim());
    if (!ps.length) return ["pairs", "Add at least one then-and-now pair."];
    if (ps.some((p) => !p.then.trim() || !p.now.trim())) return ["pairs", "Each pair needs both what you believed then and what you believe now."];
  }
  if (step === 4 && !d.pledge) return ["pledge", "Please confirm you’ve removed names of people, institutions and employers."];
  return null;
}

const progressBar = (n) => `<div class="progress" role="img" aria-label="Step ${n + 1} of ${STEP_TITLES.length}: ${STEP_TITLES[n]}">${STEP_TITLES.map((_, i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`;
const fi = (name, label, { type = "text", hint = "", max = 200, area = false, rows = 4, ph = "" } = {}) => {
  const v = esc(F.data[name] ?? "");
  return `<div class="field"><label for="f-${name}">${label}</label>${hint ? `<span class="hint">${hint}</span>` : ""}
    ${area ? `<textarea id="f-${name}" name="${name}" data-f="${name}" maxlength="${max}" rows="${rows}" placeholder="${esc(ph)}">${v}</textarea>` : `<input id="f-${name}" name="${name}" data-f="${name}" type="${type}" maxlength="${max}" value="${v}" placeholder="${esc(ph)}">`}
    ${area && max >= 200 ? `<div class="counter"><span data-count-for="${name}">${String(F.data[name] || "").length}</span>/${max}</div>` : ""}${errSlot(name)}</div>`;
};
const sel = (name, label, options, { blankLabel = "Choose…", hint = "" } = {}) =>
  `<div class="field"><label for="f-${name}">${label}</label>${hint ? `<span class="hint">${hint}</span>` : ""}<select id="f-${name}" name="${name}" data-f="${name}">${blankLabel ? `<option value="">${blankLabel}</option>` : ""}${options.map((o) => `<option ${F.data[name] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>${errSlot(name)}</div>`;

function stepHTML(tax) {
  const d = F.data;
  if (F.step === 0) {
    return `<div class="stack">
      ${fi("title", "Title", { max: 90, hint: "In your own words, for example “I left my PhD in year three”." })}
      ${fi("lede", "One-sentence summary", { area: true, rows: 2, max: 220, hint: "What a reader should know before they open it." })}
      ${sel("stage", "Stage when you decided", tax.stages)}
      <div class="field"><span class="lbl">Topics <span class="hint">(up to four)</span></span>
        <div class="chips" role="group" aria-label="Topics">${tax.tags.map((t) => `<button type="button" class="chip" data-action="f-tag" data-tag="${esc(t)}" aria-pressed="${d.tags.includes(t)}">${esc(t)}</button>`).join("")}</div>${errSlot("tags")}</div>
      ${fi("outcome", "How did it turn out?", { max: 70, hint: "A few words, for example “Left with a master’s degree”." })}
      <fieldset class="stack-s"><legend class="lbl">How do you feel about the outcome?</legend>
        ${TONES.map(([v, t, h]) => `<label class="opt"><input type="radio" name="tone" data-f="tone" value="${v}" ${d.tone === v ? "checked" : ""}><span><strong>${t}</strong><span class="hint">${h}</span></span></label>`).join("")}${errSlot("tone")}</fieldset></div>`;
  }
  if (F.step === 1) {
    return `<div class="stack">
      ${fi("whenLabel", "When did you decide?", { max: 60, ph: "Decided in year 3 of 6" })}
      ${fi("thenTag", "Short label for that time", { max: 40, ph: "Year 3", hint: "Shown above what you believed then." })}
      ${sel("written", "How long ago was this?", tax.whenAgo, { hint: "Shown above what you believe now." })}
      ${fi("situation", "What you were facing", { area: true, max: 1200, rows: 6 })}
      ${fi("who", "About you (optional)", { max: 120, hint: "A short description without names, for example “Biology PhD student, now a data analyst”." })}</div>`;
  }
  if (F.step === 2) {
    return `<div class="stack">
      ${fi("triedText", "What you tried", { area: true, max: 900, rows: 4, hint: "One thing per line." })}
      ${fi("happened", "What happened", { area: true, max: 1200, rows: 6 })}
      ${fi("gaveText", "What it gave you", { area: true, max: 700, rows: 3, hint: "One thing per line." })}
      ${fi("costText", "What it cost you", { area: true, max: 700, rows: 3, hint: "One thing per line. Include the real costs." })}</div>`;
  }
  if (F.step === 3) {
    return `<div class="stack">
      <p class="muted">This is the heart of a Hindsight story. Pair what you believed or feared then with what you believe now.</p>
      ${d.pairs.map((p, i) => `<div class="card stack" data-pair="${i}"><div class="row between"><strong>Pair ${i + 1}</strong>${d.pairs.length > 1 ? `<button type="button" class="btn quiet sm" style="color:var(--danger)" data-action="f-remove-pair" data-i="${i}">Remove</button>` : ""}</div>
        <div class="field"><label for="p${i}l">About…</label><input id="p${i}l" type="text" maxlength="60" data-f="pairs.${i}.label" value="${esc(p.label)}" placeholder="About leaving"></div>
        <div class="field"><label for="p${i}t">What I believed or feared then</label><textarea id="p${i}t" maxlength="300" rows="3" data-f="pairs.${i}.then">${esc(p.then)}</textarea></div>
        <div class="field"><label for="p${i}n">What I believe now</label><textarea id="p${i}n" maxlength="300" rows="3" data-f="pairs.${i}.now">${esc(p.now)}</textarea></div></div>`).join("")}
      ${errSlot("pairs")}
      ${d.pairs.length < 4 ? `<button type="button" class="btn ghost" data-action="f-add-pair">Add another pair</button>` : ""}
      ${fi("unresolved", "What’s still unresolved (optional)", { area: true, max: 500, rows: 3, hint: "You don’t need a tidy ending." })}</div>`;
  }
  if (F.step === 4) {
    return `<div class="stack">
      <fieldset class="stack-s"><legend class="lbl">How should your name appear?</legend>
        <label class="opt"><input type="radio" name="identityMode" data-f="identityMode" value="anonymous" ${d.identityMode === "anonymous" ? "checked" : ""}><span><strong>Anonymous</strong><span class="hint">Readers see “Anonymous”.</span></span></label>
        <label class="opt"><input type="radio" name="identityMode" data-f="identityMode" value="first_name" ${d.identityMode === "first_name" ? "checked" : ""}><span><strong>My first name</strong><span class="hint">Readers see “${esc(state.user.displayName.split(/\s+/)[0])}”. Your email is never shown.</span></span></label></fieldset>
      <label class="check"><input type="checkbox" name="pledge" data-f="pledge" ${d.pledge ? "checked" : ""}><span class="small">I’ve removed names of people, institutions, and employers, and I haven’t included contact details.</span></label>${errSlot("pledge")}
      <label class="check"><input type="checkbox" name="allowQuestions" data-f="allowQuestions" ${d.allowQuestions ? "checked" : ""}><span><strong>Allow readers to send me questions</strong><span class="hint" style="display:block">You see each question first and choose whether to reply. You can change this any time.</span></span></label>
      <div class="card stack" id="q-opts" ${d.allowQuestions ? "" : "hidden"}>
        ${sel("replyWindow", "I’ll reply within", tax.replyWindows, { blankLabel: "" })}
        ${sel("replyFormat", "Format", tax.replyFormats, { blankLabel: "" })}
        ${fi("topicsWelcomeText", "Topics I’m happy to discuss", { max: 200, hint: "Separate with commas." })}
        ${fi("offLimits", "Topics I won’t discuss", { max: 200 })}</div></div>`;
  }
  const prev = { ...payload(d), id: 0, author: d.identityMode === "first_name" ? state.user.displayName.split(/\s+/)[0] : "Anonymous", whenLabel: d.whenLabel, thenTag: d.thenTag, written: d.written, identityMode: d.identityMode };
  return `<div class="stack-l"><div class="stack-s"><p class="muted">This is how your story will look to readers. A moderator reviews it before it’s published.</p></div>
    <div class="card stack-l">${storyBodyHTML(prev)}</div>
    <div class="card stack-s"><strong>Contact</strong><p class="small muted">${d.allowQuestions ? `Open to questions. You’ll reply ${esc(d.replyWindow)}, ${esc(d.replyFormat.toLowerCase())}.` : "Not taking questions. The story stands on its own."}</p></div></div>`;
}

async function formView(id) {
  const tax = await loadTaxonomy();
  const key = draftKey(id);
  if (!F || F.key !== key) {
    F = { key, id, step: 0, data: blank(), error: null, restored: false };
    if (id) {
      const { story } = await api("GET", "/stories/" + id);
      if (!story.mine) throw new Error("Not found.");
      F.data = fromStory(story);
    } else {
      try {
        const raw = localStorage.getItem(key);
        if (raw) { const o = JSON.parse(raw); F.data = { ...blank(), ...o.data }; F.step = Math.min(o.step || 0, STEP_TITLES.length - 1); F.restored = true; }
      } catch { /* ignore */ }
    }
  }
  const last = F.step === STEP_TITLES.length - 1;
  return {
    title: id ? "Edit story" : "Share a story", back: "#/share", bare: true,
    html: `<div class="stack-l" id="sform">${progressBar(F.step)}
      <div class="stack-s"><span class="eyebrow">Step ${F.step + 1} of ${STEP_TITLES.length}</span><h1 class="h-page">${STEP_TITLES[F.step]}</h1>
      ${F.restored && F.step === 0 ? `<p class="hint">Your draft was restored. <button class="linkbtn" data-action="f-discard">Start over</button></p>` : ""}
      ${id ? `<p class="banner warn small">Editing sends your story back for review, and it stays hidden until it’s approved again.</p>` : ""}</div>
      ${F.error ? `<div class="banner bad" role="alert">${esc(F.error)}</div>` : ""}
      <form data-form="story-step" novalidate>${stepHTML(tax)}</form>
      <div class="row between">
        <button class="btn ghost" data-action="f-back" ${F.step === 0 ? "hidden" : ""}>Back</button><span style="flex:1"></span>
        <button class="btn" data-action="f-next">${last ? (id ? "Resubmit for review" : "Submit for review") : "Continue"}</button></div>
      ${!id ? `<p class="hint">Your progress is saved on this device as you go.</p>` : ""}</div>`,
    after(root, signal) {
      const set = (el) => {
        const path = el.dataset.f; if (!path) return;
        const val = el.type === "checkbox" ? el.checked : el.value;
        const parts = path.split("."); let o = F.data;
        while (parts.length > 1) o = o[parts.shift()];
        o[parts[0]] = val;
        const c = root.querySelector(`[data-count-for="${path}"]`); if (c) c.textContent = String(val).length;
        if (path === "allowQuestions") { const q = $("#q-opts", root); if (q) q.hidden = !val; }
        F.error = null; saveDraft();
      };
      root.addEventListener("input", (e) => set(e.target), { signal });
      root.addEventListener("change", (e) => set(e.target), { signal });
    }
  };
}
route("/share/new", () => formView(null), { auth: "user" });
route("/share/:id/edit", ({ params }) => formView(params.id), { auth: "user" });

ACTIONS["f-tag"] = (el) => {
  const t = el.dataset.tag, a = F.data.tags, i = a.indexOf(t);
  if (i > -1) a.splice(i, 1); else if (a.length < 4) a.push(t); else { toast("Choose up to four topics."); return; }
  el.setAttribute("aria-pressed", String(i === -1)); saveDraft();
};
ACTIONS["f-add-pair"] = () => { F.data.pairs.push({ label: "", then: "", now: "" }); saveDraft(); refresh(); };
ACTIONS["f-remove-pair"] = (el) => { F.data.pairs.splice(Number(el.dataset.i), 1); saveDraft(); refresh(); };
ACTIONS["f-discard"] = async () => {
  const ok = await confirmDialog({ title: "Start over?", body: "Your saved draft will be cleared.", confirmLabel: "Start over", danger: true });
  if (!ok) return;
  try { localStorage.removeItem(F.key); } catch { /* ignore */ }
  F = null; refresh();
};
ACTIONS["f-back"] = () => { if (F.step > 0) { F.step--; F.error = null; saveDraft(); refresh(); window.scrollTo(0, 0); } };
ACTIONS["f-next"] = async (el) => {
  if (F.step < STEP_TITLES.length - 1) {
    const v = validate(F.step, F.data);
    if (v) {
      F.error = v[1]; refresh();
      setTimeout(() => { const f = document.querySelector(`[name="${v[0]}"], [data-f="${v[0]}"]`); if (f && f.focus) f.focus(); window.scrollTo(0, 0); }, 30);
      return;
    }
    F.step++; F.error = null; saveDraft(); refresh(); window.scrollTo(0, 0);
    return;
  }
  // Final step: re-check everything, then submit.
  for (let s = 0; s < 5; s++) {
    const v = validate(s, F.data);
    if (v) { F.step = s; F.error = v[1]; refresh(); window.scrollTo(0, 0); return; }
  }
  busy(el, true, "Submitting…");
  try {
    if (F.id) await api("PUT", "/stories/" + F.id, payload(F.data)); else await api("POST", "/stories", payload(F.data));
    try { localStorage.removeItem(F.key); } catch { /* ignore */ }
    F = null;
    toast("Submitted for review. Thank you.");
    go("#/share");
  } catch (e) {
    busy(el, false);
    if (e.field && FIELD_STEP[e.field] !== undefined) F.step = FIELD_STEP[e.field];
    F.error = e.message; refresh(); window.scrollTo(0, 0);
  }
};
FORMS["story-step"] = () => {};

/* ---------- Question settings ---------- */
route("/share/:id/settings", async ({ params }) => {
  const tax = await loadTaxonomy();
  const { story: s } = await api("GET", "/stories/" + params.id);
  if (!s.mine) throw new Error("Not found.");
  const c = s.connect;
  return {
    title: "Question settings", back: "#/share", bare: true,
    html: `<form class="stack" data-form="settings" data-id="${s.id}" novalidate>
      <div class="stack-s"><h1 class="h-page">Question settings</h1><p class="muted">${esc(s.title)}. Changes take effect right away.</p></div>
      ${formErrorBox}
      <label class="check"><input type="checkbox" name="allowQuestions" ${c.open ? "checked" : ""}><span><strong>Allow readers to send me questions</strong></span></label>
      <div class="field"><label for="rw">I’ll reply within</label><select id="rw" name="replyWindow">${tax.replyWindows.map((o) => `<option ${c.window === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
      <div class="field"><label for="rf">Format</label><select id="rf" name="replyFormat">${tax.replyFormats.map((o) => `<option ${c.format === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
      <div class="field"><label for="tw">Topics I’m happy to discuss</label><input id="tw" name="topicsWelcome" type="text" maxlength="200" value="${esc(c.topics.join(", "))}"><span class="hint">Separate with commas.</span></div>
      <div class="field"><label for="ol">Topics I won’t discuss</label><input id="ol" name="offLimits" type="text" maxlength="200" value="${esc(c.off)}"></div>
      <button class="btn block" type="submit">Save settings</button></form>`
  };
}, { auth: "user" });
FORMS.settings = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  await api("PATCH", `/stories/${form.dataset.id}/settings`, {
    allowQuestions: f.allowQuestions === "on", replyWindow: f.replyWindow, replyFormat: f.replyFormat,
    topicsWelcome: String(f.topicsWelcome || "").split(",").map((x) => x.trim()).filter(Boolean), offLimits: f.offLimits
  });
  toast("Settings saved");
  go("#/share");
};
