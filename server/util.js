"use strict";
const crypto = require("crypto");

/* ---------- Shared vocab ---------- */
const STAGES = ["Undergraduate", "Master’s", "PhD", "Postdoc", "Early career", "Other"];
const STORY_STAGES = STAGES;
const TAGS = [
  "Leaving a PhD", "Staying in a PhD", "Academia vs industry", "Advisor relationship", "Switching advisors or labs",
  "Imposter feelings", "Burnout", "Postdoc", "Master’s", "Changing careers", "Early career", "Job search",
  "Starting a business", "Money and risk", "Moving for work or study", "Returning to school", "Balancing caregiving and study",
  "Choosing a field"
];
const TONES = ["positive", "mixed", "unresolved"];
const REPLY_WINDOWS = ["about a week", "about 2 weeks", "about a month"];
const REPLY_FORMATS = ["Written replies only", "Written replies, or a short call"];
const WHEN_AGO = ["a few months later", "about a year later", "2 years later", "3 or more years later"];
const PICKS = ["Something I hadn’t considered", "A cost I’d weigh differently", "Matches my situation closely", "Differs from my situation"];
const REPORT_REASONS = ["It could identify a real person", "It contains harassment or unsafe content", "It looks fake or like an advertisement", "Something else"];

/* ---------- Errors and validation ---------- */
class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const bad = (msg, field) => new HttpError(400, msg, field);

function str(v, { min = 0, max = 2000, field = "value", label } = {}) {
  const name = label || field;
  if (v == null) v = "";
  if (typeof v !== "string") throw bad(`${name} must be text.`, field);
  v = v.replace(/\r\n/g, "\n").trim();
  if (v.length < min) throw bad(min === 1 ? `${name} is required.` : `${name} needs at least ${min} characters.`, field);
  if (v.length > max) throw bad(`${name} can be at most ${max} characters.`, field);
  return v;
}
function list(v, { maxItems = 6, maxLen = 200, field = "list", label, min = 0 } = {}) {
  const name = label || field;
  if (v == null) v = [];
  if (typeof v === "string") v = v.split("\n");
  if (!Array.isArray(v)) throw bad(`${name} must be a list.`, field);
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  if (out.length < min) throw bad(`${name}: add at least ${min}.`, field);
  if (out.length > maxItems) throw bad(`${name}: at most ${maxItems} items.`, field);
  for (const x of out) if (x.length > maxLen) throw bad(`${name}: each item can be at most ${maxLen} characters.`, field);
  return out;
}
function oneOf(v, options, { field = "value", label } = {}) {
  if (!options.includes(v)) throw bad(`Choose a valid ${label || field}.`, field);
  return v;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function email(v) {
  v = str(v, { min: 1, max: 254, field: "email", label: "Email" }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw bad("Enter a valid email address.", "email");
  return v;
}
function password(v, field = "password") {
  if (typeof v !== "string") throw bad("Password is required.", field);
  if (v.length < 10) throw bad("Use at least 10 characters for your password.", field);
  if (v.length > 200) throw bad("Password is too long.", field);
  return v;
}

/* Keeps contact details out of public stories so people use consent-based questions instead. */
const CONTACT_PATTERNS = [
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i,
  /https?:\/\/|www\./i,
  /(\+?\d[\d\s().-]{8,}\d)/,
  /(^|\s)@[a-z0-9_.]{3,}/i
];
function noContactInfo(text, label) {
  for (const re of CONTACT_PATTERNS) {
    if (re.test(text)) throw bad(`${label}: please remove emails, phone numbers, links, and social handles. Readers can reach you through questions instead.`);
  }
  return text;
}

/* ---------- Tokens ---------- */
const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");

/* ---------- Search and matching ---------- */
const STOP = new Set(["the", "and", "for", "with", "about", "thinking", "that", "this", "what", "how", "should", "been", "have", "from", "into", "whether",
  "feeling", "feel", "like", "want", "not", "are", "was", "were", "can", "who", "going", "think", "some", "would", "could", "does", "doing", "really",
  "very", "just", "also", "but", "you", "your", "she", "her", "they", "them", "its", "our", "out", "all", "get", "got", "any", "has", "had", "when", "then"]);
const SYN = {
  quit: ["leaving", "leave"], quitting: ["leaving", "leave"], drop: ["leaving"], dropping: ["leaving"], dropout: ["leaving"], left: ["leaving"],
  fraud: ["imposter"], impostor: ["imposter"], doubt: ["imposter"], belong: ["imposter"], belonging: ["imposter"],
  toxic: ["advisor", "difficult"], supervisor: ["advisor"], mentor: ["advisor"],
  startup: ["business"], entrepreneur: ["business"], entrepreneurship: ["business"], company: ["industry"], corporate: ["industry"],
  professor: ["academia", "faculty"], tenure: ["academia", "faculty"], faculty: ["academia"],
  switch: ["changing", "change"], switching: ["changing", "change"], pivot: ["changing", "career"], transition: ["changing"],
  exhausted: ["burnout"], tired: ["burnout"], overwhelmed: ["burnout"], stress: ["burnout"],
  debt: ["money"], savings: ["money"], broke: ["money"], salary: ["money"], pay: ["money"],
  doctorate: ["phd"], doctoral: ["phd"], gradschool: ["master"], masters: ["master"], postdoctoral: ["postdoc"]
};
const stemOf = (w) => w.slice(0, 5);
function words(text) {
  return (String(text).toLowerCase().replace(/[’']/g, "").match(/[a-z]+/g) || []).filter((w) => w.length > 1 && !STOP.has(w));
}
function queryStems(q) {
  const out = new Set();
  for (const w of words(q)) {
    if (w.length < 3) continue;
    out.add(stemOf(w));
    (SYN[w] || []).forEach((x) => out.add(stemOf(x)));
  }
  return [...out];
}
function indexStory(s) {
  const tagStems = new Set(), titleStems = new Set(), bodyStems = new Set();
  s.tags.forEach((t) => words(t).forEach((w) => tagStems.add(stemOf(w))));
  words(s.title + " " + s.lede + " " + s.outcome).forEach((w) => titleStems.add(stemOf(w)));
  words([s.who, s.situation, s.happened, s.unresolved, s.stage].join(" ")).forEach((w) => bodyStems.add(stemOf(w)));
  return { tagStems, titleStems, bodyStems };
}
function scoreStory(s, qs) {
  const ix = indexStory(s);
  let n = 0;
  for (const q of qs) {
    if (ix.tagStems.has(q)) n += 3;
    else if (ix.titleStems.has(q)) n += 2;
    else if (ix.bodyStems.has(q)) n += 1;
  }
  const matched = s.tags.filter((t) => words(t).some((w) => qs.includes(stemOf(w))));
  return { n, matched };
}

/* ---------- Email ---------- */
const outbox = [];
let transport = null;
function mailer() {
  if (transport || !process.env.SMTP_URL) return transport;
  transport = require("nodemailer").createTransport(process.env.SMTP_URL);
  return transport;
}
const smtpConfigured = () => !!process.env.SMTP_URL;
async function sendMail({ to, subject, text }) {
  const from = process.env.MAIL_FROM || "Hindsight <no-reply@localhost>";
  outbox.push({ to, subject, text, at: Date.now() });
  if (outbox.length > 50) outbox.shift();
  const t = mailer();
  if (!t) {
    console.log(`\n[mail:dev] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  try { await t.sendMail({ from, to, subject, text }); }
  catch (e) { console.error("Mail send failed:", e.message); }
}
const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");

module.exports = {
  STAGES, STORY_STAGES, TAGS, TONES, REPLY_WINDOWS, REPLY_FORMATS, WHEN_AGO, PICKS, REPORT_REASONS,
  HttpError, bad, str, list, oneOf, email, password, noContactInfo,
  newToken, hashToken, queryStems, scoreStory, sendMail, smtpConfigured, appUrl, outbox
};
