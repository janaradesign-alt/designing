"use strict";
const express = require("express");
const { db, now, j } = require("./db");
const U = require("./util");
const { requireAuth, requireAdmin, requireVerified } = require("./auth");

const router = express.Router();
const parse = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };
const firstName = (n) => (n || "").trim().split(/\s+/)[0] || "Anonymous";

/* ---------- Shaping ---------- */
function storyOut(r, viewer, extra = {}) {
  const mine = !!(viewer && r.author_id === viewer.id);
  const author = r.identity_mode === "first_name" ? firstName(r.display_name) : "Anonymous";
  return {
    id: r.id, isSample: !!r.is_sample, mine, status: r.status,
    moderationNote: mine || (viewer && viewer.role === "admin") ? r.moderation_note : null,
    title: r.title, lede: r.lede, stage: r.stage, outcome: r.outcome, tone: r.tone,
    who: r.who, author, identityMode: r.identity_mode,
    whenLabel: r.when_label, thenTag: r.then_tag, written: r.written_label,
    situation: r.situation, tried: parse(r.tried), happened: r.happened,
    gave: parse(r.gave), cost: parse(r.cost), pairs: parse(r.pairs), unresolved: r.unresolved,
    tags: parse(r.tags),
    connect: {
      open: !!r.allow_questions, window: r.reply_window, format: r.reply_format,
      topics: parse(r.topics_welcome), off: r.off_limits
    },
    contrast: r.contrast_id ? contrastOut(r) : null,
    publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at,
    ...extra
  };
}
function contrastOut(r) {
  const c = db.prepare("SELECT id, title, identity_mode, display_name FROM stories WHERE id = ? AND status = 'published'").get(r.contrast_id);
  if (!c) return null;
  return { id: c.id, title: c.title, author: c.identity_mode === "first_name" ? firstName(c.display_name) : "Anonymous", line: r.contrast_line };
}
function cardOut(r, viewer, extra = {}) {
  const o = storyOut(r, viewer, extra);
  delete o.situation; delete o.tried; delete o.happened; delete o.gave; delete o.cost; delete o.pairs; delete o.unresolved; delete o.contrast;
  return o;
}
function viewerFlags(ids, viewer) {
  const saved = new Set(), asked = new Set();
  if (viewer && ids.length) {
    const q = ids.map(() => "?").join(",");
    db.prepare(`SELECT story_id FROM saves WHERE user_id = ? AND story_id IN (${q})`).all(viewer.id, ...ids).forEach((x) => saved.add(x.story_id));
    db.prepare(`SELECT story_id FROM questions WHERE asker_id = ? AND status != 'withdrawn' AND story_id IN (${q})`).all(viewer.id, ...ids).forEach((x) => asked.add(x.story_id));
  }
  return { saved, asked };
}
function getStory(id) {
  return db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
}
function visibleTo(r, user) {
  if (!r) return false;
  if (r.status === "published") return true;
  return !!(user && (r.author_id === user.id || user.role === "admin"));
}
const idParam = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw new U.HttpError(404, "Not found.");
  return n;
};

/* ---------- Vocab ---------- */
router.get("/taxonomy", (_req, res) => {
  res.json({
    stages: U.STAGES, tags: U.TAGS, tones: U.TONES, replyWindows: U.REPLY_WINDOWS, replyFormats: U.REPLY_FORMATS,
    whenAgo: U.WHEN_AGO, picks: U.PICKS, reportReasons: U.REPORT_REASONS
  });
});

/* ---------- Discover ---------- */
router.get("/stories", requireAuth, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 400) : "";
  const stage = typeof req.query.stage === "string" && U.STAGES.includes(req.query.stage) ? req.query.stage : null;
  const openOnly = req.query.open === "1";
  const qs = U.queryStems(q);
  const rows = db.prepare("SELECT * FROM stories WHERE status = 'published'").all();
  const topics = parse(req.user.topics);
  const items = [];
  rows.forEach((r, i) => {
    if (stage && r.stage !== stage) return;
    if (openOnly && !r.allow_questions) return;
    const tags = parse(r.tags);
    let score = 0, why = [], reason = "";
    if (qs.length) {
      const m = U.scoreStory({ tags, title: r.title, lede: r.lede, outcome: r.outcome, who: r.who, situation: r.situation, happened: r.happened, unresolved: r.unresolved, stage: r.stage }, qs);
      if (m.n === 0) return;
      score = m.n; why = m.matched; reason = m.matched.length ? "query-tags" : "query-words";
    } else if (topics.length) {
      why = tags.filter((t) => topics.includes(t));
      score = why.length * 3 + (req.user.stage && r.stage === req.user.stage ? 2 : 0);
      reason = why.length ? "topics" : "";
    }
    items.push({ r, score, why, reason, i });
  });
  items.sort((a, b) => (b.score - a.score) || ((b.r.published_at || 0) - (a.r.published_at || 0)) || (a.i - b.i));
  const flags = viewerFlags(items.map((x) => x.r.id), req.user);
  res.json({
    query: q, personalized: !qs.length && topics.length > 0,
    stories: items.map((x) => cardOut(x.r, req.user, { match: { tags: x.why, reason: x.reason }, saved: flags.saved.has(x.r.id), asked: flags.asked.has(x.r.id) }))
  });
});

router.get("/stories/:id", requireAuth, (req, res) => {
  const r = getStory(idParam(req));
  if (!visibleTo(r, req.user)) throw new U.HttpError(404, "This story isn’t available.");
  const saved = !!db.prepare("SELECT 1 FROM saves WHERE user_id = ? AND story_id = ?").get(req.user.id, r.id);
  const refl = db.prepare("SELECT picks, body FROM reflections WHERE user_id = ? AND story_id = ?").get(req.user.id, r.id);
  const q = db.prepare("SELECT id, body, ident, status, reply_body, created_at, replied_at FROM questions WHERE asker_id = ? AND story_id = ? AND status != 'withdrawn' ORDER BY id DESC LIMIT 1").get(req.user.id, r.id);
  const reported = !!db.prepare("SELECT 1 FROM reports WHERE story_id = ? AND reporter_id = ?").get(r.id, req.user.id);
  const blocked = r.author_id ? !!db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(r.author_id, req.user.id) : false;
  const dayAgo = now() - 24 * 3600 * 1000;
  const askedToday = db.prepare("SELECT COUNT(*) c FROM questions WHERE asker_id = ? AND created_at > ?").get(req.user.id, dayAgo).c;
  res.json({
    story: storyOut(r, req.user, {
      saved,
      reflection: refl ? { picks: parse(refl.picks), text: refl.body } : { picks: [], text: "" },
      question: q ? { id: q.id, text: q.body, ident: q.ident, status: q.status, reply: q.reply_body, createdAt: q.created_at, repliedAt: q.replied_at } : null,
      reported,
      canAsk: !!r.allow_questions && r.status === "published" && r.author_id !== req.user.id && !blocked,
      askLimitReached: askedToday >= 5
    })
  });
});

/* ---------- Saving and reflecting ---------- */
router.put("/stories/:id/save", requireAuth, (req, res) => {
  const r = getStory(idParam(req));
  if (!visibleTo(r, req.user)) throw new U.HttpError(404, "This story isn’t available.");
  db.prepare("INSERT OR IGNORE INTO saves (user_id,story_id,created_at) VALUES (?,?,?)").run(req.user.id, r.id, now());
  res.json({ saved: true });
});
router.delete("/stories/:id/save", requireAuth, (req, res) => {
  db.prepare("DELETE FROM saves WHERE user_id = ? AND story_id = ?").run(req.user.id, idParam(req));
  res.json({ saved: false });
});
router.get("/saved", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT s.* FROM saves v JOIN stories s ON s.id = v.story_id WHERE v.user_id = ? AND s.status = 'published' ORDER BY v.created_at DESC`).all(req.user.id);
  const out = rows.map((r) => {
    const refl = db.prepare("SELECT picks, body FROM reflections WHERE user_id = ? AND story_id = ?").get(req.user.id, r.id);
    const q = db.prepare("SELECT status, reply_body FROM questions WHERE asker_id = ? AND story_id = ? AND status != 'withdrawn' ORDER BY id DESC LIMIT 1").get(req.user.id, r.id);
    return cardOut(r, req.user, { saved: true, reflection: refl ? { picks: parse(refl.picks), text: refl.body } : null, questionStatus: q ? q.status : null });
  });
  res.json({ stories: out });
});
router.put("/stories/:id/reflection", requireAuth, (req, res) => {
  const r = getStory(idParam(req));
  if (!visibleTo(r, req.user)) throw new U.HttpError(404, "This story isn’t available.");
  const picks = U.list((req.body || {}).picks, { maxItems: 4, maxLen: 60, field: "picks" });
  for (const p of picks) U.oneOf(p, U.PICKS, { field: "picks" });
  const text = U.str((req.body || {}).text, { max: 2000, field: "text", label: "Reflection" });
  db.prepare(`INSERT INTO reflections (user_id,story_id,picks,body,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id,story_id) DO UPDATE SET picks = excluded.picks, body = excluded.body, updated_at = excluded.updated_at`)
    .run(req.user.id, r.id, j(picks), text, now());
  if (req.body.save !== false) db.prepare("INSERT OR IGNORE INTO saves (user_id,story_id,created_at) VALUES (?,?,?)").run(req.user.id, r.id, now());
  res.json({ ok: true });
});

/* ---------- Questions ---------- */
router.post("/stories/:id/questions", requireAuth, requireVerified, (req, res) => {
  const r = getStory(idParam(req));
  if (!r || r.status !== "published") throw new U.HttpError(404, "This story isn’t available.");
  if (!r.allow_questions) throw new U.HttpError(403, "This contributor isn’t taking questions.");
  if (r.author_id === req.user.id) throw new U.HttpError(400, "You can’t ask a question on your own story.");
  if (r.author_id && db.prepare("SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?").get(r.author_id, req.user.id)) {
    throw new U.HttpError(403, "This contributor isn’t taking questions from you.");
  }
  const body = U.str((req.body || {}).text, { min: 10, max: 500, field: "text", label: "Your question" });
  const ident = U.oneOf((req.body || {}).ident || "anonymous", ["anonymous", "first_name"], { field: "ident" });
  const open = db.prepare("SELECT 1 FROM questions WHERE asker_id = ? AND story_id = ? AND status = 'pending'").get(req.user.id, r.id);
  if (open) throw new U.HttpError(409, "You already have a question waiting on this story. Withdraw it first if you’d like to ask something different.");
  const recent = db.prepare("SELECT COUNT(*) c FROM questions WHERE asker_id = ? AND created_at > ?").get(req.user.id, now() - 24 * 3600 * 1000).c;
  if (recent >= 5) throw new U.HttpError(429, "You’ve sent several questions today. Please wait before sending more, so contributors aren’t overwhelmed.");
  const out = db.prepare("INSERT INTO questions (story_id,asker_id,body,ident,created_at) VALUES (?,?,?,?,?)").run(r.id, req.user.id, body, ident, now());
  res.status(201).json({ id: out.lastInsertRowid });
});

router.post("/questions/:id/withdraw", requireAuth, (req, res) => {
  const id = idParam(req);
  const q = db.prepare("SELECT * FROM questions WHERE id = ? AND asker_id = ?").get(id, req.user.id);
  if (!q) throw new U.HttpError(404, "Not found.");
  if (q.status !== "pending") throw new U.HttpError(400, "Only a question that is still waiting can be withdrawn.");
  db.prepare("UPDATE questions SET status = 'withdrawn' WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.get("/questions/received", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT q.*, s.title, u.display_name AS asker_name FROM questions q JOIN stories s ON s.id = q.story_id JOIN users u ON u.id = q.asker_id
    WHERE s.author_id = ? AND q.status != 'withdrawn' ORDER BY (q.status = 'pending') DESC, q.created_at DESC`).all(req.user.id);
  res.json({
    questions: rows.map((q) => ({
      id: q.id, storyId: q.story_id, storyTitle: q.title, text: q.body, status: q.status, reply: q.reply_body,
      from: q.ident === "first_name" ? firstName(q.asker_name) : "An anonymous reader",
      createdAt: q.created_at, repliedAt: q.replied_at, unread: !q.author_seen
    }))
  });
});
router.get("/questions/sent", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT q.*, s.title, s.is_sample, s.reply_window, s.identity_mode, s.display_name FROM questions q JOIN stories s ON s.id = q.story_id
    WHERE q.asker_id = ? AND q.status != 'withdrawn' ORDER BY q.created_at DESC`).all(req.user.id);
  res.json({
    questions: rows.map((q) => ({
      id: q.id, storyId: q.story_id, storyTitle: q.title, to: q.identity_mode === "first_name" ? firstName(q.display_name) : "the contributor",
      text: q.body, status: q.status, reply: q.reply_body, window: q.reply_window, isSample: !!q.is_sample,
      createdAt: q.created_at, repliedAt: q.replied_at, unread: !q.asker_seen
    }))
  });
});
router.post("/questions/:id/seen", requireAuth, (req, res) => {
  const id = idParam(req);
  db.prepare("UPDATE questions SET asker_seen = 1 WHERE id = ? AND asker_id = ?").run(id, req.user.id);
  db.prepare("UPDATE questions SET author_seen = 1 WHERE id = ? AND story_id IN (SELECT id FROM stories WHERE author_id = ?)").run(id, req.user.id);
  res.json({ ok: true });
});
function ownedQuestion(req) {
  const id = idParam(req);
  const q = db.prepare("SELECT q.* FROM questions q JOIN stories s ON s.id = q.story_id WHERE q.id = ? AND s.author_id = ?").get(id, req.user.id);
  if (!q) throw new U.HttpError(404, "Not found.");
  return q;
}
router.post("/questions/:id/reply", requireAuth, (req, res) => {
  const q = ownedQuestion(req);
  if (q.status !== "pending") throw new U.HttpError(400, "This question has already been answered or declined.");
  const text = U.str((req.body || {}).text, { min: 2, max: 2000, field: "text", label: "Your reply" });
  db.prepare("UPDATE questions SET status = 'answered', reply_body = ?, replied_at = ?, author_seen = 1, asker_seen = 0 WHERE id = ?").run(text, now(), q.id);
  res.json({ ok: true });
});
router.post("/questions/:id/decline", requireAuth, (req, res) => {
  const q = ownedQuestion(req);
  if (q.status !== "pending") throw new U.HttpError(400, "This question has already been answered or declined.");
  db.transaction(() => {
    db.prepare("UPDATE questions SET status = 'declined', replied_at = ?, author_seen = 1, asker_seen = 0 WHERE id = ?").run(now(), q.id);
    if ((req.body || {}).block === true) db.prepare("INSERT OR IGNORE INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(req.user.id, q.asker_id, now());
  })();
  res.json({ ok: true });
});

router.get("/badges", requireAuth, (req, res) => {
  const received = db.prepare("SELECT COUNT(*) c FROM questions q JOIN stories s ON s.id = q.story_id WHERE s.author_id = ? AND q.status = 'pending'").get(req.user.id).c;
  const replies = db.prepare("SELECT COUNT(*) c FROM questions WHERE asker_id = ? AND asker_seen = 0 AND status IN ('answered','declined')").get(req.user.id).c;
  const admin = req.user.role === "admin"
    ? db.prepare("SELECT (SELECT COUNT(*) FROM stories WHERE status = 'pending') + (SELECT COUNT(*) FROM reports WHERE status = 'open') AS c").get().c : 0;
  res.json({ inbox: received + replies, received, replies, admin });
});

/* ---------- Reports ---------- */
router.post("/stories/:id/report", requireAuth, (req, res) => {
  const r = getStory(idParam(req));
  if (!r || r.status !== "published") throw new U.HttpError(404, "This story isn’t available.");
  const reason = U.oneOf((req.body || {}).reason, U.REPORT_REASONS, { field: "reason", label: "reason" });
  const details = U.str((req.body || {}).details, { max: 1000, field: "details", label: "Details" });
  if (db.prepare("SELECT 1 FROM reports WHERE story_id = ? AND reporter_id = ?").get(r.id, req.user.id)) return res.json({ ok: true });
  db.prepare("INSERT INTO reports (story_id,reporter_id,reason,details,created_at) VALUES (?,?,?,?,?)").run(r.id, req.user.id, reason, details, now());
  res.status(201).json({ ok: true });
});

/* ---------- Contributing ---------- */
function readStoryBody(b, user) {
  b = b || {};
  const s = {};
  s.title = U.noContactInfo(U.str(b.title, { min: 8, max: 90, field: "title", label: "Title" }), "Title");
  s.lede = U.noContactInfo(U.str(b.lede, { min: 20, max: 220, field: "lede", label: "Summary" }), "Summary");
  s.stage = U.oneOf(b.stage, U.STORY_STAGES, { field: "stage", label: "stage" });
  s.outcome = U.noContactInfo(U.str(b.outcome, { min: 3, max: 70, field: "outcome", label: "Outcome" }), "Outcome");
  s.tone = U.oneOf(b.tone, U.TONES, { field: "tone", label: "feeling about the outcome" });
  s.who = U.noContactInfo(U.str(b.who, { max: 120, field: "who", label: "About you" }), "About you");
  s.identity_mode = U.oneOf(b.identityMode || "anonymous", ["anonymous", "first_name"], { field: "identityMode" });
  s.when_label = U.noContactInfo(U.str(b.whenLabel, { min: 3, max: 60, field: "whenLabel", label: "When you decided" }), "When you decided");
  s.then_tag = U.noContactInfo(U.str(b.thenTag, { min: 2, max: 40, field: "thenTag", label: "Short label for then" }), "Short label");
  s.written_label = U.oneOf(b.written, U.WHEN_AGO, { field: "written", label: "time since" });
  s.situation = U.noContactInfo(U.str(b.situation, { min: 40, max: 1200, field: "situation", label: "The situation" }), "The situation");
  s.tried = U.list(b.tried, { min: 1, maxItems: 6, maxLen: 200, field: "tried", label: "What you tried" }).map((x) => U.noContactInfo(x, "What you tried"));
  s.happened = U.noContactInfo(U.str(b.happened, { min: 40, max: 1200, field: "happened", label: "What happened" }), "What happened");
  s.gave = U.list(b.gave, { min: 1, maxItems: 5, maxLen: 140, field: "gave", label: "What it gave you" }).map((x) => U.noContactInfo(x, "What it gave you"));
  s.cost = U.list(b.cost, { min: 1, maxItems: 5, maxLen: 140, field: "cost", label: "What it cost you" }).map((x) => U.noContactInfo(x, "What it cost you"));
  const pairs = Array.isArray(b.pairs) ? b.pairs : [];
  const cleanPairs = pairs.map((p) => ({
    label: U.str(p && p.label, { max: 60, field: "pairs", label: "Then and now label" }),
    then: U.str(p && p.then, { max: 300, field: "pairs", label: "Then" }),
    now: U.str(p && p.now, { max: 300, field: "pairs", label: "Now" })
  })).filter((p) => p.then || p.now);
  if (cleanPairs.length < 1) throw U.bad("Add at least one then-and-now pair.", "pairs");
  if (cleanPairs.length > 4) throw U.bad("Use at most four then-and-now pairs.", "pairs");
  cleanPairs.forEach((p) => {
    if (!p.then || !p.now) throw U.bad("Each then-and-now pair needs both sides.", "pairs");
    if (!p.label) p.label = "About this decision";
    U.noContactInfo(p.label + " " + p.then + " " + p.now, "Then and now");
  });
  s.pairs = cleanPairs;
  s.unresolved = U.noContactInfo(U.str(b.unresolved, { max: 500, field: "unresolved", label: "Still unresolved" }), "Still unresolved");
  s.tags = U.list(b.tags, { min: 1, maxItems: 4, maxLen: 60, field: "tags", label: "Topics" });
  s.tags.forEach((t) => U.oneOf(t, U.TAGS, { field: "tags" }));
  if (b.pledge !== true) throw U.bad("Please confirm you’ve removed names of people, institutions and employers.", "pledge");
  Object.assign(s, readSettings(b));
  return s;
}
function readSettings(b) {
  const allow = b.allowQuestions === true;
  return {
    allow_questions: allow ? 1 : 0,
    reply_window: U.oneOf(b.replyWindow || "about 2 weeks", U.REPLY_WINDOWS, { field: "replyWindow", label: "reply window" }),
    reply_format: U.oneOf(b.replyFormat || "Written replies only", U.REPLY_FORMATS, { field: "replyFormat", label: "reply format" }),
    topics_welcome: allow ? j(U.list(b.topicsWelcome, { maxItems: 5, maxLen: 80, field: "topicsWelcome" })) : "[]",
    off_limits: U.str(b.offLimits, { max: 200, field: "offLimits", label: "Off-limits topics" })
  };
}
const toRow = (s) => ({ ...s, tried: j(s.tried), gave: j(s.gave), cost: j(s.cost), pairs: j(s.pairs), tags: j(s.tags) });

const COLS = ["title", "lede", "stage", "outcome", "tone", "who", "identity_mode", "when_label", "then_tag", "written_label", "situation", "tried", "happened",
  "gave", "cost", "pairs", "unresolved", "tags", "allow_questions", "reply_window", "reply_format", "topics_welcome", "off_limits"];

router.post("/stories", requireAuth, requireVerified, (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) c FROM stories WHERE author_id = ? AND status = 'pending'").get(req.user.id).c;
  if (pending >= 3) throw new U.HttpError(429, "You have several stories waiting for review. Please wait until one is reviewed before sending another.");
  const s = toRow(readStoryBody(req.body, req.user));
  const t = now();
  const sql = `INSERT INTO stories (author_id,is_sample,status,display_name,created_at,updated_at,${COLS.join(",")})
    VALUES (@author_id,0,'pending',@display_name,@t,@t,${COLS.map((c) => "@" + c).join(",")})`;
  const r = db.prepare(sql).run({ ...s, author_id: req.user.id, display_name: req.user.display_name, t });
  res.status(201).json({ id: r.lastInsertRowid });
});

function ownedStory(req) {
  const r = getStory(idParam(req));
  if (!r || r.author_id !== req.user.id) throw new U.HttpError(404, "Not found.");
  return r;
}

router.get("/my/stories", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM stories WHERE author_id = ? AND status != 'withdrawn' ORDER BY created_at DESC").all(req.user.id);
  res.json({
    stories: rows.map((r) => {
      const waiting = db.prepare("SELECT COUNT(*) c FROM questions WHERE story_id = ? AND status = 'pending'").get(r.id).c;
      return cardOut(r, req.user, { waitingQuestions: waiting });
    })
  });
});

/* Editing sends the story back for review, since the text changes what readers see. */
router.put("/stories/:id", requireAuth, requireVerified, (req, res) => {
  const r = ownedStory(req);
  const s = toRow(readStoryBody(req.body, req.user));
  const sets = COLS.map((c) => `${c} = @${c}`).join(", ");
  db.prepare(`UPDATE stories SET ${sets}, status = 'pending', moderation_note = NULL, display_name = @display_name, updated_at = @t WHERE id = @id`)
    .run({ ...s, display_name: req.user.display_name, t: now(), id: r.id });
  res.json({ id: r.id, status: "pending" });
});

/* Question settings can change at any time without a new review. */
router.patch("/stories/:id/settings", requireAuth, (req, res) => {
  const r = ownedStory(req);
  const st = readSettings(req.body);
  db.prepare("UPDATE stories SET allow_questions = @allow_questions, reply_window = @reply_window, reply_format = @reply_format, topics_welcome = @topics_welcome, off_limits = @off_limits, updated_at = @t WHERE id = @id")
    .run({ ...st, t: now(), id: r.id });
  res.json({ ok: true });
});

router.delete("/stories/:id", requireAuth, (req, res) => {
  const r = ownedStory(req);
  db.prepare("DELETE FROM stories WHERE id = ?").run(r.id);
  res.json({ ok: true });
});

/* ---------- Admin ---------- */
router.get("/admin/overview", requireAuth, requireAdmin, (_req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  res.json({
    stats: {
      users: c("SELECT COUNT(*) c FROM users"), published: c("SELECT COUNT(*) c FROM stories WHERE status = 'published' AND is_sample = 0"),
      pending: c("SELECT COUNT(*) c FROM stories WHERE status = 'pending'"), samples: c("SELECT COUNT(*) c FROM stories WHERE is_sample = 1"),
      questions: c("SELECT COUNT(*) c FROM questions WHERE status != 'withdrawn'"), answered: c("SELECT COUNT(*) c FROM questions WHERE status = 'answered'"),
      openReports: c("SELECT COUNT(*) c FROM reports WHERE status = 'open'")
    },
    pending: db.prepare("SELECT * FROM stories WHERE status = 'pending' ORDER BY updated_at ASC").all().map((r) => storyOut(r, { id: -1, role: "admin" })),
    reports: db.prepare(`SELECT r.*, s.title FROM reports r JOIN stories s ON s.id = r.story_id WHERE r.status = 'open' ORDER BY r.created_at ASC`).all()
      .map((x) => ({ id: x.id, storyId: x.story_id, storyTitle: x.title, reason: x.reason, details: x.details, createdAt: x.created_at }))
  });
});

router.post("/admin/stories/:id/review", requireAuth, requireAdmin, (req, res) => {
  const r = getStory(idParam(req));
  if (!r) throw new U.HttpError(404, "Not found.");
  const decision = U.oneOf((req.body || {}).decision, ["approve", "reject"], { field: "decision" });
  const note = U.str((req.body || {}).note, { max: 500, field: "note", label: "Note" });
  if (decision === "reject" && note.length < 5) throw U.bad("Add a short note so the contributor knows what to change.", "note");
  if (decision === "approve") {
    db.prepare("UPDATE stories SET status = 'published', moderation_note = NULL, published_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), r.id);
  } else {
    db.prepare("UPDATE stories SET status = 'rejected', moderation_note = ?, updated_at = ? WHERE id = ?").run(note, now(), r.id);
  }
  if (r.author_id) {
    const u = db.prepare("SELECT email, display_name FROM users WHERE id = ?").get(r.author_id);
    if (u) {
      U.sendMail({
        to: u.email,
        subject: decision === "approve" ? "Your Hindsight story is live" : "Your Hindsight story needs a change",
        text: decision === "approve"
          ? `Hi ${u.display_name},\n\nYour story "${r.title}" has been published. Thank you for sharing it.\n`
          : `Hi ${u.display_name},\n\nYour story "${r.title}" wasn't published yet.\n\nNote from the reviewer: ${note}\n\nYou can edit it in the app and send it back for review.\n`
      }).catch(() => {});
    }
  }
  res.json({ ok: true });
});

router.post("/admin/reports/:id/resolve", requireAuth, requireAdmin, (req, res) => {
  const id = idParam(req);
  const rep = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  if (!rep) throw new U.HttpError(404, "Not found.");
  const action = U.oneOf((req.body || {}).action, ["dismiss", "unpublish"], { field: "action" });
  const note = U.str((req.body || {}).note, { max: 500, field: "note", label: "Note" });
  db.transaction(() => {
    db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?").run(action + (note ? ": " + note : ""), now(), id);
    if (action === "unpublish") {
      db.prepare("UPDATE stories SET status = 'rejected', moderation_note = ?, updated_at = ? WHERE id = ?")
        .run(note || "Unpublished after a report. Please review the community guidelines and edit your story.", now(), rep.story_id);
      db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = ? WHERE story_id = ? AND status = 'open'").run("unpublish", now(), rep.story_id);
    }
  })();
  res.json({ ok: true });
});

router.post("/admin/samples/remove", requireAuth, requireAdmin, (_req, res) => {
  const r = db.prepare("DELETE FROM stories WHERE is_sample = 1").run();
  res.json({ removed: r.changes });
});

module.exports = { router };
