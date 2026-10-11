import { state, api, esc, $, $$, icon, logo, loadTaxonomy, toast, errSlot, formErrorBox, clearErrors, showFormError, busy, firstName } from "./core.js";
import { route, ACTIONS, FORMS, go } from "./router.js";

const footLinks = `<div class="footlinks"><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="#/guidelines">Community guidelines</a></div>`;
const afterAuth = (u) => go(u.onboarded ? "#/discover" : "#/onboarding");

/* ---------- Welcome ---------- */
route("/welcome", async () => ({
  title: "Hindsight", bare: true, hideBar: true,
  html: `<div class="welcome">
    <div class="brand" style="justify-content:flex-start;font:500 1.5rem/1 var(--serif)">${logo}<span>Hindsight</span></div>
    <div class="stack">
      <h1 class="h-display">Someone’s <em>been</em> where you are.</h1>
      <p class="lead">Find women who faced a decision like yours. Read what they feared, what happened, and what they know now. Ask a question if they’re open to it.</p>
    </div>
    <ol class="how stack" style="padding:0;margin:0">
      <li><span class="dot">1</span><div><strong>Discover</strong><span class="muted">Describe your situation and find experiences that resemble it.</span></div></li>
      <li><span class="dot">2</span><div><strong>Understand</strong><span class="muted">See what someone believed then next to what she knows now, including the parts that didn’t resolve.</span></div></li>
      <li><span class="dot">3</span><div><strong>Connect</strong><span class="muted">Send a question to contributors who’ve chosen to take them. They decide whether to reply.</span></div></li>
    </ol>
    <div class="stack-s">
      <a class="btn block" href="#/signup">Create an account</a>
      <a class="btn ghost block" href="#/login">Log in</a>
    </div>
    ${footLinks}
  </div>`
}), { auth: "guest" });

/* ---------- Sign up and log in ---------- */
function pwField(name, label, autocomplete, hint) {
  return `<div class="field"><label for="${name}">${label}</label>
    <div class="pw"><input id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" required>
    <button type="button" class="iconbtn" data-action="toggle-pw" data-target="${name}" aria-label="Show password">${icon.eye}</button></div>
    ${hint ? `<span class="hint">${hint}</span>` : ""}${errSlot(name)}</div>`;
}
ACTIONS["toggle-pw"] = (el) => {
  const i = document.getElementById(el.dataset.target);
  const show = i.type === "password";
  i.type = show ? "text" : "password";
  el.innerHTML = show ? icon.eyeOff : icon.eye;
  el.setAttribute("aria-label", show ? "Hide password" : "Show password");
};

route("/signup", async () => ({
  title: "Create account", back: "#/welcome", bare: true,
  html: `<form class="stack" data-form="signup" novalidate>
    <div class="stack-s"><h1 class="h-page">Create your account</h1><p class="muted">Your email is never shown to other people.</p></div>
    ${formErrorBox}
    <div class="field"><label for="displayName">Your first name</label><input id="displayName" name="displayName" type="text" autocomplete="given-name" maxlength="40" required><span class="hint">If you share a story, you choose whether this name appears.</span>${errSlot("displayName")}</div>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required>${errSlot("email")}</div>
    ${pwField("password", "Password", "new-password", "At least 10 characters.")}
    <label class="check"><input type="checkbox" name="agree"><span class="small">I’m 18 or older, and I agree to the <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>.</span></label>${errSlot("agree")}
    <button class="btn block" type="submit">Create account</button>
    <p class="small muted">Already have an account? <a href="#/login">Log in</a></p>
  </form>`
}), { auth: "guest" });

FORMS.signup = async (form, btn) => {
  const f = Object.fromEntries(new FormData(form));
  const r = await api("POST", "/auth/signup", { displayName: f.displayName, email: f.email, password: f.password, agree: f.agree === "on" });
  state.user = r.user;
  go("#/onboarding");
};

route("/login", async () => ({
  title: "Log in", back: "#/welcome", bare: true,
  html: `<form class="stack" data-form="login" novalidate>
    <div class="stack-s"><h1 class="h-page">Welcome back</h1></div>
    ${formErrorBox}
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required>${errSlot("email")}</div>
    ${pwField("password", "Password", "current-password")}
    <button class="btn block" type="submit">Log in</button>
    <p class="small"><a href="#/forgot">Forgot your password?</a></p>
    <p class="small muted">New here? <a href="#/signup">Create an account</a></p>
  </form>`
}), { auth: "guest" });

FORMS.login = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  const r = await api("POST", "/auth/login", { email: f.email, password: f.password });
  state.user = r.user;
  const next = sessionStorage.getItem("hs-next");
  sessionStorage.removeItem("hs-next");
  if (r.user.onboarded && next) go(next); else afterAuth(r.user);
};

/* ---------- Password reset ---------- */
route("/forgot", async () => ({
  title: "Reset password", back: "#/login", bare: true,
  html: `<form class="stack" data-form="forgot" novalidate>
    <div class="stack-s"><h1 class="h-page">Reset your password</h1><p class="muted">Enter your email and we’ll send a link that works for one hour.</p></div>
    ${formErrorBox}
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="off" required>${errSlot("email")}</div>
    <button class="btn block" type="submit">Send reset link</button>
  </form>`
}), { auth: "guest" });
FORMS.forgot = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  const r = await api("POST", "/auth/forgot", { email: f.email });
  form.innerHTML = `<div class="stack"><h1 class="h-page">Check your email</h1><p class="muted">${esc(r.message)}</p><a class="btn ghost block" href="#/login">Back to log in</a></div>`;
};

route("/reset", async ({ query }) => ({
  title: "New password", bare: true,
  html: `<form class="stack" data-form="reset" novalidate>
    <div class="stack-s"><h1 class="h-page">Choose a new password</h1></div>
    ${formErrorBox}
    <input type="hidden" name="token" value="${esc(query.get("token") || "")}">
    ${pwField("password", "New password", "new-password", "At least 10 characters.")}
    <button class="btn block" type="submit">Save password</button>
  </form>`
}), { auth: "public" });
FORMS.reset = async (form) => {
  const f = Object.fromEntries(new FormData(form));
  await api("POST", "/auth/reset", { token: f.token, password: f.password });
  toast("Password updated. Log in with your new password.");
  go("#/login");
};

/* ---------- Email verification ---------- */
route("/verify", async ({ query }) => {
  let ok = false, msg = "";
  try { await api("POST", "/auth/verify", { token: query.get("token") || "" }); ok = true; }
  catch (e) { msg = e.message; }
  return {
    title: "Email", bare: true,
    html: `<div class="stack"><h1 class="h-page">${ok ? "Email confirmed" : "That link didn’t work"}</h1>
      <p class="muted">${ok ? "Thank you. You can now share stories and send questions." : esc(msg)}</p>
      <a class="btn block" href="#/${state.user ? "discover" : "login"}">Continue</a></div>`
  };
}, { auth: "public" });

/* ---------- Onboarding ---------- */
const ob = { step: 0, stage: null, topics: [], intent: "both", agree: false };
const STEPS = 4;
const progress = () => `<div class="progress" role="img" aria-label="Step ${ob.step + 1} of ${STEPS}">${Array.from({ length: STEPS }, (_, i) => `<i class="${i <= ob.step ? "on" : ""}"></i>`).join("")}</div>`;

function obStep(tax) {
  const name = esc(firstName(state.user.displayName));
  if (ob.step === 0) {
    return `<div class="stack"><h1 class="h-page">Hi ${name}. Where are you right now?</h1><p class="muted">This helps put the most relevant stories first. You can change it any time.</p>
      <fieldset class="stack-s"><legend class="sr-only">Your stage</legend>${tax.stages.map((s) => `<label class="opt"><input type="radio" name="stage" value="${esc(s)}" ${ob.stage === s ? "checked" : ""}><span><strong>${esc(s)}</strong></span></label>`).join("")}</fieldset></div>`;
  }
  if (ob.step === 1) {
    return `<div class="stack"><h1 class="h-page">What are you navigating?</h1><p class="muted">Choose up to five. Your Discover feed starts with these.</p>
      <div class="chips" role="group" aria-label="Topics">${tax.tags.map((t) => `<button type="button" class="chip" data-action="ob-topic" data-topic="${esc(t)}" aria-pressed="${ob.topics.includes(t)}">${esc(t)}</button>`).join("")}</div>
      <p class="hint" id="ob-count">${ob.topics.length} of 5 chosen</p></div>`;
  }
  if (ob.step === 2) {
    const opts = [["read", "Read and learn", "Find stories and ask questions."], ["share", "Share my own story", "Help someone who is where I was."], ["both", "Both", "Learn from others and share when I’m ready."]];
    return `<div class="stack"><h1 class="h-page">How would you like to use Hindsight?</h1>
      <fieldset class="stack-s"><legend class="sr-only">How you'll use Hindsight</legend>${opts.map(([v, t, d]) => `<label class="opt"><input type="radio" name="intent" value="${v}" ${ob.intent === v ? "checked" : ""}><span><strong>${t}</strong><span class="hint">${d}</span></span></label>`).join("")}</fieldset></div>`;
  }
  return `<div class="stack"><h1 class="h-page">A few ground rules</h1><p class="muted">Hindsight works because people are honest and careful with each other.</p>
    <ul class="stack-s" style="padding-left:20px">
      <li><strong>Perspective, not prescription.</strong> Stories show what happened to someone else. They aren’t advice about what you should do.</li>
      <li><strong>Consent comes first.</strong> Contributors choose whether they take questions, and they can decline any of them.</li>
      <li><strong>Protect privacy.</strong> Don’t name or identify other people, schools, or employers in stories or questions.</li>
      <li><strong>Honesty over inspiration.</strong> Setbacks and unresolved endings belong here.</li>
    </ul>
    <label class="check"><input type="checkbox" id="ob-agree" ${ob.agree ? "checked" : ""}><span class="small">I’ve read the <a href="#/guidelines">community guidelines</a> and I’ll follow them.</span></label>
    <p class="err" id="ob-err" role="alert" hidden></p></div>`;
}

route("/onboarding", async () => {
  const tax = await loadTaxonomy();
  if (state.user.stage && !ob.stage) ob.stage = state.user.stage;
  return {
    title: "Welcome", bare: true, hideBar: true,
    html: `<div class="stack-l" id="ob">${progress()}<div id="ob-body">${obStep(tax)}</div>
      <div class="ob-nav"><button class="btn ghost" data-action="ob-back" ${ob.step === 0 ? "hidden" : ""}>Back</button>
      <span style="flex:1"></span>
      ${ob.step > 0 && ob.step < 3 ? '<button class="btn quiet" data-action="ob-skip">Skip</button>' : ""}
      <button class="btn" data-action="ob-next">${ob.step === STEPS - 1 ? "Start exploring" : "Continue"}</button></div></div>`
  };
}, { auth: "onboarding" });

function obRerender() { go("#/onboarding", true); }
ACTIONS["ob-topic"] = (el) => {
  const t = el.dataset.topic, i = ob.topics.indexOf(t);
  if (i > -1) ob.topics.splice(i, 1); else if (ob.topics.length < 5) ob.topics.push(t); else { toast("You can choose up to five."); return; }
  el.setAttribute("aria-pressed", String(i === -1));
  $("#ob-count").textContent = ob.topics.length + " of 5 chosen";
};
ACTIONS["ob-back"] = () => { if (ob.step > 0) { ob.step--; obRerender(); } };
ACTIONS["ob-skip"] = () => { ob.step++; obRerender(); };
ACTIONS["ob-next"] = async (el) => {
  const stageEl = $('input[name="stage"]:checked'); if (ob.step === 0 && stageEl) ob.stage = stageEl.value;
  const intentEl = $('input[name="intent"]:checked'); if (ob.step === 2 && intentEl) ob.intent = intentEl.value;
  if (ob.step < STEPS - 1) { ob.step++; obRerender(); return; }
  ob.agree = $("#ob-agree").checked;
  if (!ob.agree) { const e = $("#ob-err"); e.textContent = "Please confirm you’ve read the community guidelines."; e.hidden = false; return; }
  busy(el, true, "Saving…");
  try {
    const r = await api("POST", "/me/onboarding", { stage: ob.stage, topics: ob.topics, intent: ob.intent, agreeGuidelines: true });
    state.user = r.user;
    const intent = ob.intent;
    ob.step = 0;
    go(intent === "share" ? "#/share" : "#/discover");
  } catch (e) { busy(el, false); toast(e.message); }
};

/* ---------- Legal pages ---------- */
function support() {
  return state.config.supportEmail ? `<p>Questions about these terms or your data? Email <a href="mailto:${esc(state.config.supportEmail)}">${esc(state.config.supportEmail)}</a>.</p>` : "";
}
const legal = (title, body) => ({ title, back: "history", bare: !state.user, html: `<article class="legal"><h1 class="h-page">${title}</h1>${body}${support()}</article>` });

route("/terms", async () => legal("Terms of use", `
  <p class="muted">Last updated October 2026.</p>
  <h2>Who can use Hindsight</h2><p>Hindsight is for people who are 18 or older. You’re responsible for the account you create and for keeping your password private.</p>
  <h2>What Hindsight is</h2><p>Hindsight shares personal experiences so people can learn from one another. Stories and replies are one person’s account of what happened to them. They aren’t professional, medical, legal, financial, or academic advice, and they don’t tell you what to do.</p>
  <h2>What you share</h2><ul>
    <li>Share only your own experience, and be honest about it.</li>
    <li>Don’t name or describe people, schools, or employers in a way that could identify them.</li>
    <li>Don’t post contact details, advertisements, or anything harassing, hateful, or unsafe.</li>
    <li>You keep ownership of your stories. By submitting one, you let Hindsight display it to other signed-in users until you remove it.</li></ul>
  <h2>Moderation</h2><p>Stories are reviewed before they’re published. We may reject or remove content, and suspend accounts that break these rules or the community guidelines.</p>
  <h2>Questions between members</h2><p>Questions are optional for contributors. A contributor may ignore, decline, or block anyone, and we may limit how many questions an account can send.</p>
  <h2>Your account</h2><p>You can download your data or delete your account in Profile at any time. Deleting your account removes your stories, questions, saves, and reflections.</p>
  <h2>Changes and liability</h2><p>We may update these terms and will note the date above. Hindsight is provided as is, and to the extent the law allows, we’re not liable for decisions people make after reading stories.</p>`), { auth: "public" });

route("/privacy", async () => legal("Privacy policy", `
  <p class="muted">Last updated October 2026.</p>
  <h2>What we collect</h2><ul>
    <li>Account details: your name, email address, and a securely hashed password.</li>
    <li>Your preferences: stage, topics, and how you plan to use Hindsight.</li>
    <li>What you create: stories you submit, questions you send, replies you write, saved stories, reflections, and reports.</li></ul>
  <h2>Who can see what</h2><ul>
    <li>Your email address is never shown to other members.</li>
    <li>Published stories appear to signed-in members under the name option you chose: anonymous or first name only.</li>
    <li>A question shows the contributor either “an anonymous reader” or your first name, whichever you pick when you send it.</li>
    <li>Your saved stories and reflections are private to you.</li>
    <li>Moderators can read submitted stories and reported content to review them.</li></ul>
  <h2>How we use it</h2><p>We use your information to run the app, send account emails (confirmation and password reset), and keep the community safe. We don’t sell your data and we don’t show ads or use third-party trackers.</p>
  <h2>Cookies and storage</h2><p>We use one essential cookie to keep you signed in. Your device also stores a few preferences, such as the appearance setting, and unsent story drafts.</p>
  <h2>Your choices</h2><p>In Profile you can edit your details, download a copy of your data, or delete your account. Deleting your account permanently removes your content from Hindsight.</p>
  <h2>Retention and security</h2><p>We keep your data while your account exists. Passwords are hashed, connections are encrypted, and sessions expire after 30 days.</p>`), { auth: "public" });

route("/guidelines", async () => legal("Community guidelines", `
  <h2>Experience before expertise</h2><p>A lived experience is valuable without a title or credential behind it.</p>
  <h2>Perspective over prescription</h2><p>Share what happened and what you learned. Please don’t tell readers what they should do.</p>
  <h2>Honesty over inspiration</h2><p>Regrets, setbacks, and unresolved endings deserve space alongside things that worked out.</p>
  <h2>Connection by consent</h2><p>Contributors decide whether to take questions, how to reply, and what is off limits. Respect a decline or silence without following up elsewhere.</p>
  <h2>Privacy for everyone</h2><p>Leave out names and details that could identify other people, schools, or employers. Never share anyone’s contact details.</p>
  <h2>Reporting</h2><p>If a story looks unsafe or identifies someone, use “Report this story.” A moderator reviews every report.</p>
  <h2>Support</h2><p>Hindsight can’t replace professional help. If you’re in crisis or thinking about harming yourself, contact local emergency services, or in the US call or text 988.</p>`), { auth: "public" });
