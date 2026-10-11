"use strict";
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { db } = require("./db");
const U = require("./util");
const auth = require("./auth");
const api = require("./api");

const app = express();
const PUBLIC = path.join(__dirname, "..", "public");

if (process.env.NODE_ENV === "production") app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));
app.disable("x-powered-by");

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"],
      "connect-src": ["'self'"],
      "manifest-src": ["'self'"],
      "worker-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === "production"
}));

app.get("/healthz", (_req, res) => {
  db.prepare("SELECT 1").get();
  res.json({ ok: true });
});

/* ---------- API ---------- */
app.use("/api", express.json({ limit: "100kb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin) {
      let host = "";
      try { host = new URL(origin).host; } catch { /* invalid origin */ }
      if (host !== req.get("host")) return next(new U.HttpError(403, "Request blocked."));
    }
    if (!req.is("application/json") && req.headers["content-length"] && req.headers["content-length"] !== "0") {
      return next(new U.HttpError(415, "Send JSON."));
    }
  }
  next();
});
app.use("/api", rateLimit({
  windowMs: 5 * 60 * 1000, limit: process.env.NODE_ENV === "test" ? 100000 : 600, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
}));
app.use("/api", auth.loadUser);
app.use("/api", auth.router);
app.use("/api", api.router);
app.use("/api", (_req, _res, next) => next(new U.HttpError(404, "Not found.")));

/* ---------- Static app ---------- */
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders(res, file) {
    if (/sw\.js$|index\.html$|manifest\.webmanifest$/.test(file)) res.setHeader("Cache-Control", "no-cache");
    else if (/\/fonts\/|\/icons\//.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else res.setHeader("Cache-Control", "no-cache");
    if (/\.webmanifest$/.test(file)) res.setHeader("Content-Type", "application/manifest+json");
  }
}));
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/") || path.extname(req.path)) return next();
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC, "index.html"));
});

/* ---------- Errors ---------- */
app.use((err, _req, res, _next) => {
  if (err instanceof U.HttpError) return res.status(err.status).json({ error: err.message, field: err.field });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "That request couldn’t be read." });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "That’s too much text to send at once." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

/* Clear out expired sessions and tokens once an hour. */
function cleanup() {
  const t = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(t);
  db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(t);
}
cleanup();
setInterval(cleanup, 3600 * 1000).unref();

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Hindsight is running on http://localhost:${port}`));
}
module.exports = app;
