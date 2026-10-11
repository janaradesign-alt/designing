import { state, api, esc, $, toast, errSlot, formErrorBox, busy, refreshBadges, confirmDialog, ago } from "./core.js";
import { route, ACTIONS, FORMS, go, refresh } from "./router.js";

const STATUS_TEXT = { pending: "Waiting for a reply", answered: "Answered", declined: "Not answered" };

route("/inbox", async ({ query }) => {
  const tab = query.get("tab") === "sent" ? "sent" : "received";
  const [rec, sent] = await Promise.all([api("GET", "/questions/received"), api("GET", "/questions/sent")]);
  const pendingIn = rec.questions.filter((q) => q.status === "pending").length;
  const unreadOut = sent.questions.filter((q) => q.unread).length;
  // Mark things as seen once shown, then refresh the tab badge.
  const seen = (tab === "received" ? rec.questions.filter((q) => q.unread) : sent.questions.filter((q) => q.unread));
  Promise.all(seen.map((q) => api("POST", `/questions/${q.id}/seen`))).then(refreshBadges).catch(() => {});

  const receivedHTML = rec.questions.length ? `<div class="list">${rec.questions.map((q) => `<div class="item">
      <div class="row between"><span class="pill ${q.status === "pending" ? "st-pending" : q.status === "answered" ? "st-published" : ""}">${STATUS_TEXT[q.status]}</span><span class="hint">${ago(q.createdAt)}</span></div>
      <p class="small muted">${esc(q.from)} asked about <a href="#/story/${q.storyId}">${esc(q.storyTitle)}</a></p>
      <blockquote class="quote then">${esc(q.text)}</blockquote>
      ${q.status === "answered" ? `<div class="reply"><strong>Your reply</strong><p>${esc(q.reply)}</p></div>` : ""}
      ${q.status === "pending" ? `<form class="stack-s" data-form="reply" data-id="${q.id}" novalidate>${formErrorBox}
        <div class="field"><label for="r${q.id}">Your reply</label><textarea id="r${q.id}" name="text" maxlength="2000" placeholder="Reply if you’d like to. You can also decline."></textarea>${errSlot("text")}</div>
        <div class="row"><button class="btn sm" type="submit">Send reply</button>
        <button type="button" class="btn ghost sm" data-action="decline" data-id="${q.id}">Decline</button>
        <button type="button" class="btn quiet sm" style="color:var(--danger)" data-action="decline-block" data-id="${q.id}">Decline and block</button></div>
        <p class="hint">Declining is private and always okay. Blocking stops this person from sending you more questions.</p></form>` : ""}
    </div>`).join("")}</div>`
    : `<div class="empty"><h3>No questions yet</h3><p class="muted">When a reader sends you a question about a published story, it appears here. You decide whether to reply.</p><a class="btn sm ghost" href="#/share">Your stories</a></div>`;

  const sentHTML = sent.questions.length ? `<div class="list">${sent.questions.map((q) => `<div class="item">
      <div class="row between"><span class="pill ${q.status === "pending" ? "st-pending" : q.status === "answered" ? "st-published" : ""}">${STATUS_TEXT[q.status]}</span><span class="hint">${ago(q.createdAt)}</span></div>
      <p class="small muted">To ${esc(q.to)} about <a href="#/story/${q.storyId}">${esc(q.storyTitle)}</a></p>
      <blockquote class="quote then">${esc(q.text)}</blockquote>
      ${q.status === "answered" ? `<div class="reply"><strong>Reply</strong><p>${esc(q.reply)}</p></div>` : ""}
      ${q.status === "declined" ? `<p class="small muted">She chose not to answer this question. That’s her right, and you can keep learning from the story.</p>` : ""}
      ${q.status === "pending" ? `<p class="small muted">${q.isSample ? "This is an example story, so no one will reply." : `Replies usually arrive ${esc(q.window)}.`}</p>
        <div><button class="btn ghost sm" data-action="withdraw-sent" data-id="${q.id}">Withdraw</button></div>` : ""}
    </div>`).join("")}</div>`
    : `<div class="empty"><h3>No questions sent</h3><p class="muted">Find a story from someone who takes questions and ask what it didn’t cover.</p><a class="btn sm" href="#/discover?open=1">Find stories that take questions</a></div>`;

  return {
    title: "Inbox", tab: "inbox",
    html: `<div class="stack"><h1 class="h-page">Inbox</h1>
      <div class="seg" role="group" aria-label="Inbox view">
        <button data-action="inbox-tab" data-tab="received" aria-pressed="${tab === "received"}">Received${pendingIn ? ` (${pendingIn})` : ""}</button>
        <button data-action="inbox-tab" data-tab="sent" aria-pressed="${tab === "sent"}">Sent${unreadOut ? ` (${unreadOut})` : ""}</button></div>
      ${tab === "received" ? receivedHTML : sentHTML}</div>`
  };
}, { auth: "user" });

ACTIONS["inbox-tab"] = (el) => go("#/inbox" + (el.dataset.tab === "sent" ? "?tab=sent" : ""), true);
FORMS.reply = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  await api("POST", `/questions/${form.dataset.id}/reply`, { text: f.text });
  toast("Reply sent"); refreshBadges(); refresh();
};
ACTIONS.decline = async (el) => {
  const ok = await confirmDialog({ title: "Decline this question?", body: "The reader is told you chose not to answer. They aren’t told why.", confirmLabel: "Decline" });
  if (!ok) return;
  try { await api("POST", `/questions/${el.dataset.id}/decline`, { block: false }); toast("Question declined"); refreshBadges(); refresh(); } catch (e) { toast(e.message); }
};
ACTIONS["decline-block"] = async (el) => {
  const ok = await confirmDialog({ title: "Decline and block?", body: "This person won’t be able to send you more questions. They aren’t told they were blocked.", confirmLabel: "Decline and block", danger: true });
  if (!ok) return;
  try { await api("POST", `/questions/${el.dataset.id}/decline`, { block: true }); toast("Declined and blocked"); refreshBadges(); refresh(); } catch (e) { toast(e.message); }
};
ACTIONS["withdraw-sent"] = async (el) => {
  const ok = await confirmDialog({ title: "Withdraw this question?", body: "It will be removed from the contributor’s inbox.", confirmLabel: "Withdraw" });
  if (!ok) return;
  try { await api("POST", `/questions/${el.dataset.id}/withdraw`); toast("Question withdrawn"); refreshBadges(); refresh(); } catch (e) { toast(e.message); }
};
