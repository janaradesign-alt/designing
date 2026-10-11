"use strict";
/* End-to-end API test. Runs against a temporary database. */
process.env.NODE_ENV = "test";
process.env.DB_FILE = ":memory:";
process.env.ADMIN_EMAILS = "admin@example.com";
const assert = require("assert");
const http = require("http");
const app = require("../server/index.js");
const { outbox } = require("../server/util.js");

let server, base;
function client() {
  let cookie = "";
  return async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0].startsWith("hs_sid=") && sc.includes("hs_sid=;") ? "" : sc.split(";")[0];
    let json = null; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
}
let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { console.error("  FAIL", name, "\n      ", e.message); process.exitCode = 1; }
}

const GOOD_STORY = {
  title: "I changed advisors in year two", lede: "Switching labs delayed my degree by a year, and I would still do it again.",
  stage: "PhD", outcome: "Switched labs, graduating a year later", tone: "mixed", who: "Biology PhD student",
  identityMode: "first_name", whenLabel: "Decided in year 2 of 5", thenTag: "Year 2", written: "2 years later",
  situation: "My first advisor stopped answering messages for weeks at a time, and my project had no direction left to follow.",
  tried: ["Spoke with the graduate director", "Met three other labs"],
  happened: "I moved to a new lab in the fall, lost some of my earlier data, and rebuilt my project from a different question.",
  gave: ["Regular feedback"], cost: ["A year of time"],
  pairs: [{ label: "About switching", then: "Switching would look like failure.", now: "It looked like a normal decision to everyone else." }],
  unresolved: "I still don't know how much the earlier years taught me.",
  tags: ["Switching advisors or labs", "Advisor relationship"], pledge: true,
  allowQuestions: true, replyWindow: "about 2 weeks", replyFormat: "Written replies only", topicsWelcome: ["Meeting new labs"], offLimits: "Names"
};

(async () => {
  server = http.createServer(app).listen(0);
  base = "http://127.0.0.1:" + server.address().port;
  const ana = client(), ben = client(), admin = client(), anon = client();

  await t("health and auth gate", async () => {
    assert.equal((await anon("GET", "/healthz")).status, 200);
    assert.equal((await anon("GET", "/api/stories")).status, 401);
    const me = await anon("GET", "/api/me");
    assert.equal(me.json.user, null);
  });

  await t("signup validation", async () => {
    assert.equal((await anon("POST", "/api/auth/signup", { email: "nope", password: "longenoughpw1", displayName: "Ana", agree: true })).status, 400);
    assert.equal((await anon("POST", "/api/auth/signup", { email: "a@example.com", password: "short", displayName: "Ana", agree: true })).status, 400);
    assert.equal((await anon("POST", "/api/auth/signup", { email: "a@example.com", password: "longenoughpw1", displayName: "Ana", agree: false })).status, 400);
  });

  await t("signup, session, duplicate email", async () => {
    const r = await ana("POST", "/api/auth/signup", { email: "ana@example.com", password: "correct horse battery", displayName: "Ana Lopez", agree: true });
    assert.equal(r.status, 201); assert.equal(r.json.user.onboarded, false);
    assert.equal((await ana("GET", "/api/me")).json.user.email, "ana@example.com");
    assert.equal((await anon("POST", "/api/auth/signup", { email: "ANA@example.com", password: "correct horse battery", displayName: "Ana", agree: true })).status, 409);
  });

  await t("onboarding requires guidelines and saves preferences", async () => {
    assert.equal((await ana("POST", "/api/me/onboarding", { stage: "PhD", topics: ["Leaving a PhD"], intent: "both" })).status, 400);
    const r = await ana("POST", "/api/me/onboarding", { stage: "PhD", topics: ["Leaving a PhD", "Advisor relationship"], intent: "both", agreeGuidelines: true });
    assert.equal(r.status, 200); assert.equal(r.json.user.onboarded, true);
    assert.equal((await ana("POST", "/api/me/onboarding", { stage: "PhD", topics: ["Not a topic"], intent: "both", agreeGuidelines: true })).status, 400);
  });

  await t("login, wrong password, logout", async () => {
    const c = client();
    assert.equal((await c("POST", "/api/auth/login", { email: "ana@example.com", password: "wrong password!!" })).status, 401);
    assert.equal((await c("POST", "/api/auth/login", { email: "ana@example.com", password: "correct horse battery" })).status, 200);
    assert.equal((await c("GET", "/api/me")).json.user.displayName, "Ana Lopez");
    await c("POST", "/api/auth/logout");
    assert.equal((await c("GET", "/api/me")).json.user, null);
  });

  await t("discover: personalized feed and search with reasons", async () => {
    const feed = await ana("GET", "/api/stories");
    assert.ok(feed.json.personalized); assert.ok(feed.json.stories.length >= 5);
    assert.ok(feed.json.stories[0].tags.includes("Leaving a PhD") || feed.json.stories[0].tags.includes("Advisor relationship"));
    const s = await ana("GET", "/api/stories?q=" + encodeURIComponent("I'm thinking about leaving my PhD"));
    assert.ok(s.json.stories.length >= 1);
    assert.ok(s.json.stories[0].title.toLowerCase().includes("phd") || s.json.stories[0].match.tags.length > 0);
    const none = await ana("GET", "/api/stories?q=zzzzqqqq");
    assert.equal(none.json.stories.length, 0);
    const open = await ana("GET", "/api/stories?open=1");
    assert.ok(open.json.stories.every((x) => x.connect.open));
    const stage = await ana("GET", "/api/stories?stage=Postdoc");
    assert.ok(stage.json.stories.every((x) => x.stage === "Postdoc"));
  });

  let storyId;
  await t("story detail, save, reflect", async () => {
    const list = await ana("GET", "/api/stories?q=imposter");
    storyId = list.json.stories[0].id;
    const d = await ana("GET", "/api/stories/" + storyId);
    assert.ok(d.json.story.pairs.length >= 1);
    assert.equal((await ana("PUT", `/api/stories/${storyId}/save`)).status, 200);
    assert.equal((await ana("GET", "/api/saved")).json.stories.length, 1);
    assert.equal((await ana("PUT", `/api/stories/${storyId}/reflection`, { picks: ["Something I hadn’t considered"], text: "Useful." })).status, 200);
    const d2 = await ana("GET", "/api/stories/" + storyId);
    assert.equal(d2.json.story.reflection.text, "Useful.");
    assert.equal((await ana("PUT", `/api/stories/${storyId}/reflection`, { picks: ["bogus"], text: "" })).status, 400);
    assert.equal((await ana("DELETE", `/api/stories/${storyId}/save`)).status, 200);
    assert.equal((await ana("GET", "/api/saved")).json.stories.length, 0);
  });

  await t("contributor submission is validated (contact details, pledge)", async () => {
    assert.equal((await ana("POST", "/api/stories", { ...GOOD_STORY, pledge: false })).status, 400);
    const r = await ana("POST", "/api/stories", { ...GOOD_STORY, situation: GOOD_STORY.situation + " Email me at ana@example.com please." });
    assert.equal(r.status, 400); assert.ok(/emails, phone/.test(r.json.error));
    assert.equal((await ana("POST", "/api/stories", { ...GOOD_STORY, tags: ["Nope"] })).status, 400);
  });

  let myStory;
  await t("contributor submits; story hidden until approved", async () => {
    const r = await ana("POST", "/api/stories", GOOD_STORY);
    assert.equal(r.status, 201); myStory = r.json.id;
    await ben("POST", "/api/auth/signup", { email: "ben@example.com", password: "another long password", displayName: "Ben", agree: true });
    assert.equal((await ben("GET", "/api/stories/" + myStory)).status, 404);
    const mine = await ana("GET", "/api/my/stories");
    assert.equal(mine.json.stories[0].status, "pending");
    const feed = await ben("GET", "/api/stories?q=advisor");
    assert.ok(!feed.json.stories.some((x) => x.id === myStory));
  });

  await t("admin review: non-admin blocked, reject needs note, approve publishes", async () => {
    assert.equal((await ana("GET", "/api/admin/overview")).status, 403);
    await admin("POST", "/api/auth/signup", { email: "admin@example.com", password: "unique long passphrase", displayName: "Admin", agree: true });
    const ov = await admin("GET", "/api/admin/overview");
    assert.equal(ov.status, 200); assert.equal(ov.json.pending.length, 1);
    assert.equal((await admin("POST", `/api/admin/stories/${myStory}/review`, { decision: "reject", note: "" })).status, 400);
    assert.equal((await admin("POST", `/api/admin/stories/${myStory}/review`, { decision: "reject", note: "Please shorten the summary." })).status, 200);
    const mine = await ana("GET", "/api/my/stories");
    assert.equal(mine.json.stories[0].status, "rejected"); assert.ok(/shorten/.test(mine.json.stories[0].moderationNote));
    assert.equal((await ana("PUT", "/api/stories/" + myStory, GOOD_STORY)).json.status, "pending");
    assert.equal((await admin("POST", `/api/admin/stories/${myStory}/review`, { decision: "approve" })).status, 200);
    assert.equal((await ben("GET", "/api/stories/" + myStory)).status, 200);
    assert.ok(outbox.some((m) => /is live/.test(m.subject)));
  });

  let qid;
  await t("questions: send, limits, ownership", async () => {
    assert.equal((await ana("POST", `/api/stories/${myStory}/questions`, { text: "How did you meet new labs?" })).status, 400);
    assert.equal((await ben("POST", `/api/stories/${myStory}/questions`, { text: "short" })).status, 400);
    const r = await ben("POST", `/api/stories/${myStory}/questions`, { text: "How did you decide which lab to join?", ident: "first_name" });
    assert.equal(r.status, 201); qid = r.json.id;
    assert.equal((await ben("POST", `/api/stories/${myStory}/questions`, { text: "A second question while waiting." })).status, 409);
    const rec = await ana("GET", "/api/questions/received");
    assert.equal(rec.json.questions.length, 1); assert.equal(rec.json.questions[0].from, "Ben");
    assert.equal((await ana("GET", "/api/badges")).json.received, 1);
    assert.equal((await ben("POST", `/api/questions/${qid}/reply`, { text: "not mine" })).status, 404);
  });

  await t("questions: reply is delivered and marked unread", async () => {
    assert.equal((await ana("POST", `/api/questions/${qid}/reply`, { text: "I met three PIs and asked about their mentoring style." })).status, 200);
    const b = await ben("GET", "/api/badges"); assert.equal(b.json.replies, 1);
    const sent = await ben("GET", "/api/questions/sent");
    assert.equal(sent.json.questions[0].status, "answered"); assert.ok(sent.json.questions[0].unread);
    await ben("POST", `/api/questions/${qid}/seen`);
    assert.equal((await ben("GET", "/api/badges")).json.replies, 0);
  });

  await t("questions: decline with block stops future asks", async () => {
    const r = await ben("POST", `/api/stories/${myStory}/questions`, { text: "One more thing about timing, please." });
    assert.equal(r.status, 201);
    assert.equal((await ana("POST", `/api/questions/${r.json.id}/decline`, { block: true })).status, 200);
    const again = await ben("POST", `/api/stories/${myStory}/questions`, { text: "Trying again after being declined." });
    assert.equal(again.status, 403);
    assert.equal((await ben("GET", "/api/stories/" + myStory)).json.story.canAsk, false);
  });

  await t("questions: withdraw, and asks on closed stories are refused", async () => {
    const closed = (await ben("GET", "/api/stories?q=imposter")).json.stories.find((s) => !s.connect.open);
    assert.ok(closed);
    assert.equal((await ben("POST", `/api/stories/${closed.id}/questions`, { text: "May I ask a question here?" })).status, 403);
    const open = (await ben("GET", "/api/stories?open=1")).json.stories.find((s) => s.id !== myStory);
    const q = await ben("POST", `/api/stories/${open.id}/questions`, { text: "What would you do differently?" });
    assert.equal(q.status, 201);
    assert.equal((await ben("POST", `/api/questions/${q.json.id}/withdraw`)).status, 200);
  });

  await t("settings change without re-review", async () => {
    const r = await ana("PATCH", `/api/stories/${myStory}/settings`, { allowQuestions: false });
    assert.equal(r.status, 200);
    const s = (await ana("GET", "/api/stories/" + myStory)).json.story;
    assert.equal(s.status, "published"); assert.equal(s.connect.open, false);
  });

  await t("reports reach admin and unpublish works", async () => {
    assert.equal((await ben("POST", `/api/stories/${myStory}/report`, { reason: "bogus" })).status, 400);
    assert.equal((await ben("POST", `/api/stories/${myStory}/report`, { reason: "It could identify a real person", details: "Mentions a detail" })).status, 201);
    const ov = await admin("GET", "/api/admin/overview");
    assert.equal(ov.json.reports.length, 1);
    assert.equal((await admin("POST", `/api/admin/reports/${ov.json.reports[0].id}/resolve`, { action: "unpublish", note: "Please remove the detail." })).status, 200);
    assert.equal((await ben("GET", "/api/stories/" + myStory)).status, 404);
  });

  await t("password reset flow invalidates sessions", async () => {
    await anon("POST", "/api/auth/forgot", { email: "ben@example.com" });
    const m = outbox.filter((x) => /Reset your/.test(x.subject)).pop();
    const token = m.text.match(/token=([\w-]+)/)[1];
    assert.equal((await anon("POST", "/api/auth/reset", { token, password: "short" })).status, 400);
    assert.equal((await anon("POST", "/api/auth/reset", { token, password: "a brand new password" })).status, 200);
    assert.equal((await anon("POST", "/api/auth/reset", { token, password: "a brand new password" })).status, 400);
    assert.equal((await ben("GET", "/api/me")).json.user, null);
    assert.equal((await ben("POST", "/api/auth/login", { email: "ben@example.com", password: "a brand new password" })).status, 200);
    const unknown = await anon("POST", "/api/auth/forgot", { email: "nobody@example.com" });
    assert.equal(unknown.status, 200);
  });

  await t("change password, export, delete account", async () => {
    assert.equal((await ben("POST", "/api/me/password", { current: "wrong", next: "yet another password" })).status, 400);
    assert.equal((await ben("POST", "/api/me/password", { current: "a brand new password", next: "yet another password" })).status, 200);
    const ex = await ben("GET", "/api/me/export");
    assert.equal(ex.status, 200); assert.ok(Array.isArray(ex.json.questionsSent));
    assert.equal((await ben("DELETE", "/api/me", { password: "nope" })).status, 400);
    assert.equal((await ben("DELETE", "/api/me", { password: "yet another password" })).status, 200);
    assert.equal((await ben("GET", "/api/me")).json.user, null);
    assert.equal((await anon("POST", "/api/auth/login", { email: "ben@example.com", password: "yet another password" })).status, 401);
  });

  await t("deleting an author removes their stories", async () => {
    await ana("POST", "/api/stories", { ...GOOD_STORY, title: "A second story to be removed" });
    assert.equal((await ana("DELETE", "/api/me", { password: "correct horse battery" })).status, 200);
    const ov = await admin("GET", "/api/admin/overview");
    assert.equal(ov.json.pending.length, 0);
  });

  await t("origin check blocks cross-site writes", async () => {
    const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
    assert.equal(res.status, 403);
  });

  await t("admin can remove sample stories", async () => {
    const r = await admin("POST", "/api/admin/samples/remove");
    assert.equal(r.json.removed, 6);
  });

  server.close();
  console.log(`\n${passed} checks passed${process.exitCode ? ", with failures" : ""}.`);
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
