"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { db, now } = require("./db");
const U = require("./util");

const COOKIE = "hs_sid";
const SESSION_MS = 30 * 24 * 3600 * 1000;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

const isProd = () => process.env.NODE_ENV === "production";
const cookieOpts = () => ({ httpOnly: true, sameSite: "lax", secure: isProd(), path: "/", maxAge: SESSION_MS });
const adminEmails = () => (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function createSession(res, userId, ua) {
  const raw = U.newToken();
  db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at,user_agent) VALUES (?,?,?,?,?)")
    .run(U.hashToken(raw), userId, now(), now() + SESSION_MS, (ua || "").slice(0, 200));
  res.cookie(COOKIE, raw, cookieOpts());
}

/* Loads req.user from the session cookie, if any. */
function loadUser(req, _res, next) {
  req.user = null;
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (raw) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
      .get(U.hashToken(raw), now());
    if (row) {
      req.user = row;
      req.sessionHash = U.hashToken(raw);
      if (adminEmails().includes(row.email.toLowerCase())) row.role = "admin";
    }
  }
  next();
}
function requireAuth(req, _res, next) {
  if (!req.user) return next(new U.HttpError(401, "Please log in to continue."));
  next();
}
function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== "admin") return next(new U.HttpError(403, "Not allowed."));
  next();
}
/* When email is configured, posting and asking require a verified address. */
function requireVerified(req, _res, next) {
  if (U.smtpConfigured() && !req.user.email_verified_at) {
    return next(new U.HttpError(403, "Please verify your email address first. Check your inbox for the link, or request a new one in Profile.", "verify"));
  }
  next();
}

function userOut(u) {
  return {
    id: u.id, email: u.email, displayName: u.display_name, role: u.role,
    stage: u.stage, topics: JSON.parse(u.topics || "[]"), intent: u.intent, onboarded: !!u.onboarded,
    emailVerified: !!u.email_verified_at, verifyRequired: U.smtpConfigured() && !u.email_verified_at,
    createdAt: u.created_at
  };
}

async function sendVerification(user) {
  const raw = U.newToken();
  db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'verify'").run(user.id);
  db.prepare("INSERT INTO tokens (token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)")
    .run(U.hashToken(raw), user.id, "verify", now() + 3 * 24 * 3600 * 1000);
  await U.sendMail({
    to: user.email, subject: "Confirm your email for Hindsight",
    text: `Hi ${user.display_name},\n\nConfirm your email address to start sharing stories and asking questions:\n\n${U.appUrl()}/#/verify?token=${raw}\n\nThis link works for 3 days. If you didn't create a Hindsight account, you can ignore this message.\n`
  });
}

const router = express.Router();
/* Failed attempts are limited per IP, so guessing passwords or probing accounts gets slow. Successful requests don't count. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === "test" ? 1000 : 30, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Please wait a few minutes and try again." }
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: process.env.NODE_ENV === "test" ? 1000 : 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many new accounts were created from this network. Please try again later." }
});
router.use("/auth", authLimiter);
router.use("/auth/signup", signupLimiter);

router.post("/auth/signup", async (req, res) => {
  const b = req.body || {};
  const em = U.email(b.email);
  const name = U.str(b.displayName, { min: 2, max: 40, field: "displayName", label: "Name" });
  const pw = U.password(b.password);
  if (pw.toLowerCase().includes(em.split("@")[0]) && em.split("@")[0].length > 3) throw U.bad("Choose a password that doesn’t contain your email name.", "password");
  if (b.agree !== true) throw U.bad("Please accept the Terms and Privacy Policy to continue.", "agree");
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(em)) throw new U.HttpError(409, "An account with this email already exists. Try logging in.", "email");
  const hash = await bcrypt.hash(pw, 12);
  const role = adminEmails().includes(em) ? "admin" : "user";
  const r = db.prepare("INSERT INTO users (email,password_hash,display_name,role,agreed_terms_at,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)")
    .run(em, hash, name, role, now(), now(), now());
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid);
  createSession(res, user.id, req.headers["user-agent"]);
  if (U.smtpConfigured()) sendVerification(user).catch(() => {});
  res.status(201).json({ user: userOut(user) });
});

router.post("/auth/login", async (req, res) => {
  const b = req.body || {};
  const em = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const pw = typeof b.password === "string" ? b.password : "";
  const user = em ? db.prepare("SELECT * FROM users WHERE email = ?").get(em) : null;
  const ok = await bcrypt.compare(pw, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new U.HttpError(401, "Email or password is incorrect.");
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), user.id);
  createSession(res, user.id, req.headers["user-agent"]);
  if (adminEmails().includes(user.email.toLowerCase())) user.role = "admin";
  res.json({ user: userOut(user) });
});

router.post("/auth/logout", (req, res) => {
  if (req.sessionHash) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(req.sessionHash);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.post("/auth/forgot", async (req, res) => {
  const em = typeof (req.body || {}).email === "string" ? req.body.email.trim().toLowerCase() : "";
  const user = em ? db.prepare("SELECT * FROM users WHERE email = ?").get(em) : null;
  if (user) {
    const raw = U.newToken();
    db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'reset'").run(user.id);
    db.prepare("INSERT INTO tokens (token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)")
      .run(U.hashToken(raw), user.id, "reset", now() + 60 * 60 * 1000);
    await U.sendMail({
      to: user.email, subject: "Reset your Hindsight password",
      text: `Hi ${user.display_name},\n\nUse this link to choose a new password. It works for one hour:\n\n${U.appUrl()}/#/reset?token=${raw}\n\nIf you didn't ask for this, you can ignore this message and your password will stay the same.\n`
    });
  }
  res.json({ ok: true, message: "If an account exists for that email, a reset link is on its way." });
});

router.post("/auth/reset", async (req, res) => {
  const b = req.body || {};
  const pw = U.password(b.password);
  const tok = typeof b.token === "string" ? b.token : "";
  const row = db.prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'reset' AND used_at IS NULL AND expires_at > ?").get(U.hashToken(tok), now());
  if (!row) throw new U.HttpError(400, "This reset link has expired or was already used. Request a new one.");
  const hash = await bcrypt.hash(pw, 12);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, row.user_id);
    db.prepare("UPDATE tokens SET used_at = ? WHERE token_hash = ?").run(now(), row.token_hash);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id);
  })();
  res.json({ ok: true });
});

router.post("/auth/verify", (req, res) => {
  const tok = typeof (req.body || {}).token === "string" ? req.body.token : "";
  const row = db.prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'verify' AND used_at IS NULL AND expires_at > ?").get(U.hashToken(tok), now());
  if (!row) throw new U.HttpError(400, "This confirmation link has expired or was already used.");
  db.transaction(() => {
    db.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").run(now(), row.user_id);
    db.prepare("UPDATE tokens SET used_at = ? WHERE token_hash = ?").run(now(), row.token_hash);
  })();
  res.json({ ok: true });
});

const lastResend = new Map();
router.post("/auth/resend-verification", requireAuth, async (req, res) => {
  if (req.user.email_verified_at) return res.json({ ok: true });
  const last = lastResend.get(req.user.id) || 0;
  if (now() - last < 60 * 1000) throw new U.HttpError(429, "Please wait a minute before requesting another email.");
  lastResend.set(req.user.id, now());
  await sendVerification(req.user);
  res.json({ ok: true });
});

/* ---------- Me ---------- */
router.get("/me", (req, res) => {
  res.json({ user: req.user ? userOut(req.user) : null, config: { emailConfigured: U.smtpConfigured(), supportEmail: process.env.SUPPORT_EMAIL || "" } });
});

router.patch("/me", requireAuth, (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  if (b.displayName !== undefined) { sets.push("display_name = ?"); vals.push(U.str(b.displayName, { min: 2, max: 40, field: "displayName", label: "Name" })); }
  if (b.stage !== undefined) { sets.push("stage = ?"); vals.push(b.stage === null ? null : U.oneOf(b.stage, U.STAGES, { field: "stage" })); }
  if (b.topics !== undefined) {
    const t = U.list(b.topics, { maxItems: 8, maxLen: 60, field: "topics" });
    for (const x of t) U.oneOf(x, U.TAGS, { field: "topics" });
    sets.push("topics = ?"); vals.push(JSON.stringify(t));
  }
  if (b.intent !== undefined) { sets.push("intent = ?"); vals.push(U.oneOf(b.intent, ["read", "share", "both"], { field: "intent" })); }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...vals, req.user.id);
  res.json({ user: userOut(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

router.post("/me/onboarding", requireAuth, (req, res) => {
  const b = req.body || {};
  const stage = b.stage ? U.oneOf(b.stage, U.STAGES, { field: "stage" }) : null;
  const topics = U.list(b.topics, { maxItems: 8, maxLen: 60, field: "topics" });
  for (const x of topics) U.oneOf(x, U.TAGS, { field: "topics" });
  const intent = U.oneOf(b.intent || "both", ["read", "share", "both"], { field: "intent" });
  if (b.agreeGuidelines !== true) throw U.bad("Please confirm you’ve read the community guidelines.", "agreeGuidelines");
  db.prepare("UPDATE users SET stage = ?, topics = ?, intent = ?, onboarded = 1 WHERE id = ?").run(stage, JSON.stringify(topics), intent, req.user.id);
  res.json({ user: userOut(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id)) });
});

router.post("/me/password", requireAuth, async (req, res) => {
  const b = req.body || {};
  const ok = await bcrypt.compare(typeof b.current === "string" ? b.current : "", req.user.password_hash);
  if (!ok) throw new U.HttpError(400, "Your current password is incorrect.", "current");
  const pw = U.password(b.next, "next");
  const hash = await bcrypt.hash(pw, 12);
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(req.user.id, req.sessionHash);
  })();
  res.json({ ok: true });
});

router.get("/me/export", requireAuth, (req, res) => {
  const id = req.user.id;
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const data = {
    exportedAt: new Date().toISOString(),
    account: userOut(req.user),
    stories: all("SELECT * FROM stories WHERE author_id = ?", id),
    saved: all("SELECT story_id, created_at FROM saves WHERE user_id = ?", id),
    reflections: all("SELECT story_id, picks, body, updated_at FROM reflections WHERE user_id = ?", id),
    questionsSent: all("SELECT id, story_id, body, ident, status, reply_body, created_at, replied_at FROM questions WHERE asker_id = ?", id),
    questionsReceived: all("SELECT q.id, q.story_id, q.body, q.status, q.reply_body, q.created_at, q.replied_at FROM questions q JOIN stories s ON s.id = q.story_id WHERE s.author_id = ?", id),
    reportsFiled: all("SELECT story_id, reason, details, created_at FROM reports WHERE reporter_id = ?", id)
  };
  res.setHeader("Content-Disposition", 'attachment; filename="hindsight-data.json"');
  res.json(data);
});

router.delete("/me", requireAuth, async (req, res) => {
  const pw = typeof (req.body || {}).password === "string" ? req.body.password : "";
  if (!(await bcrypt.compare(pw, req.user.password_hash))) throw new U.HttpError(400, "Your password is incorrect.", "password");
  db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

module.exports = { router, loadUser, requireAuth, requireAdmin, requireVerified, userOut };
