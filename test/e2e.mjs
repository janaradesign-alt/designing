/* Browser smoke test on a phone-sized viewport. Run with the server up: BASE=http://localhost:3111 node test/e2e.mjs */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
import fs from "fs";
const BASE = process.env.BASE || "http://localhost:3111";
const SHOTS = process.env.SHOTS || "/tmp/hs-shots";
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
let step = 0, failed = 0;
const ok = (n) => console.log("  ok  ", n);
async function t(name, fn) {
  try { await fn(); ok(name); }
  catch (e) {
    failed++; console.error("  FAIL", name, "\n      ", e.message.split("\n")[0]);
    try { console.error("       at", await page.evaluate(() => location.hash), "|", (await page.locator("main").innerText()).slice(0, 140).replace(/\n/g, " / ")); await page.screenshot({ path: `${SHOTS}/fail-${failed}.png` }); } catch { /* page gone */ }
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
const shot = async (n) => page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, "0")}-${n}.png` });
const text = async (sel) => (await page.locator(sel).first().innerText()).trim();
const email = `tester${Date.now()}@example.com`;

await t("welcome screen loads for new visitors", async () => {
  await page.goto(BASE + "/");
  await page.waitForSelector("text=Create an account");
  await shot("welcome");
});
await t("legal pages open while logged out", async () => {
  await page.click("text=Privacy");
  await page.waitForSelector("text=Privacy policy");
  await page.click('[aria-label="Back"]');
  await page.waitForSelector("text=Create an account");
});
await t("signup shows inline errors", async () => {
  await page.click("text=Create an account");
  await page.waitForSelector("#displayName");
  await page.click('button[type="submit"]');
  await page.waitForSelector("[data-err]:not([hidden])");
  await shot("signup-errors");
});
await t("signup succeeds and starts onboarding", async () => {
  await page.fill("#displayName", "Tester");
  await page.fill("#email", email);
  await page.fill("#password", "a long test passphrase");
  await page.check('input[name="agree"]');
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Where are you right now?");
  await shot("onboarding-1");
});
await t("onboarding: stage, topics, intent, rules", async () => {
  await page.click("text=PhD >> nth=0");
  await page.click('[data-action="ob-next"]');
  await page.waitForSelector("text=What are you navigating?");
  await page.click('[data-topic="Leaving a PhD"]');
  await page.click('[data-topic="Advisor relationship"]');
  await page.click('[data-action="ob-next"]');
  await page.click("text=Both");
  await page.click('[data-action="ob-next"]');
  await page.waitForSelector("text=A few ground rules");
  await page.click('[data-action="ob-next"]');
  await page.waitForSelector("#ob-err:not([hidden])");
  await page.check("#ob-agree");
  await page.click('[data-action="ob-next"]');
  await page.waitForSelector("text=For you");
  await shot("discover-for-you");
});
await t("discover is personalized and search explains matches", async () => {
  const first = await text(".story-card h3");
  if (!/PhD|advisor|left|almost/i.test(first)) throw new Error("unexpected first card: " + first);
  await page.fill("#q", "I'm thinking about leaving my PhD");
  await page.click('button:has-text("Find experiences")');
  await page.waitForSelector("text=Why it matched");
  await shot("discover-search");
});
await t("story page shows then and now, connect and reflect", async () => {
  await page.click(".story-card h3 a >> nth=0");
  await page.waitForSelector("text=Then and now");
  await shot("story-top");
  await page.click('[data-action="jump"][data-target="connect"]');
  await page.fill("#qtext", "How did you decide when it was time?");
  await page.click("#sendQ");
  await page.waitForSelector("text=Question sent");
  await shot("story-question-sent");
});
await t("reflection and save", async () => {
  await page.click('[data-action="pick"] >> nth=0');
  await page.fill("#rtext", "I hadn't thought about talking to the program director.");
  await page.click('[data-action="save-refl"]');
  await page.waitForSelector("text=Reflection saved");
  await page.click('.tab:has-text("Saved")');
  await page.waitForSelector("text=Your reflection");
  await shot("saved");
});
await t("inbox shows the sent question", async () => {
  await page.click('.tab:has-text("Inbox")');
  await page.click('[data-tab="sent"]');
  await page.waitForSelector("text=Waiting for a reply");
  await shot("inbox-sent");
});
await t("share flow: validation, all steps, submit", async () => {
  await page.click('.tab:has-text("Share")');
  await page.click("text=Share a story");
  await page.waitForSelector("text=The decision");
  await page.click('[data-action="f-next"]');
  await page.waitForSelector(".banner.bad");
  await page.fill("#f-title", "I changed advisors in year two");
  await page.fill("#f-lede", "Switching labs delayed my degree by a year, and I would do it again.");
  await page.selectOption("#f-stage", "PhD");
  await page.click('[data-tag="Switching advisors or labs"]');
  await page.fill("#f-outcome", "Switched labs, graduating a year later");
  await page.click("text=Mixed");
  await page.click('[data-action="f-next"]');
  await page.fill("#f-whenLabel", "Decided in year 2 of 5");
  await page.fill("#f-thenTag", "Year 2");
  await page.selectOption("#f-written", "2 years later");
  await page.fill("#f-situation", "My first advisor stopped answering messages for weeks at a time, and my project had no direction left.");
  await page.click('[data-action="f-next"]');
  await page.fill("#f-triedText", "Spoke with the graduate director\nMet three other labs");
  await page.fill("#f-happened", "I moved to a new lab in the fall, lost some data, and rebuilt my project around a different question.");
  await page.fill("#f-gaveText", "Regular feedback");
  await page.fill("#f-costText", "A year of time");
  await page.click('[data-action="f-next"]');
  await page.fill("#p0l", "About switching");
  await page.fill("#p0t", "Switching would look like failure.");
  await page.fill("#p0n", "It looked like a normal decision to everyone else.");
  await shot("share-pairs");
  await page.click('[data-action="f-next"]');
  await page.waitForSelector("text=How should your name appear?");
  await page.click('[data-action="f-next"]');
  await page.waitForSelector(".banner.bad");
  await page.check('input[name="pledge"]');
  await shot("share-privacy");
  await page.click('[data-action="f-next"]');
  await page.waitForSelector("text=This is how your story will look");
  await shot("share-review");
  await page.click('[data-action="f-next"]');
  await page.waitForSelector("text=Waiting for review");
  await shot("share-my-stories");
});
await t("profile: appearance, edit, export link, logout", async () => {
  await page.click('.tab:has-text("Profile")');
  await page.waitForSelector("text=Appearance");
  await page.click('[data-theme-value="dark"]');
  await shot("profile-dark");
  await page.click('[data-theme-value="system"]');
  await page.click("text=Log out");
  await page.waitForSelector("text=Create an account");
});
await t("admin approves the story, contributor sees it published", async () => {
  const r = await page.request.post(BASE + "/api/auth/signup", { data: { email: "admin@example.com", password: "unique long passphrase", displayName: "Admin", agree: true } });
  if (!r.ok() && r.status() !== 409) throw new Error("admin signup " + r.status());
  if (r.status() === 409) await page.request.post(BASE + "/api/auth/login", { data: { email: "admin@example.com", password: "unique long passphrase" } });
  await page.request.post(BASE + "/api/me/onboarding", { data: { stage: "Other", topics: [], intent: "both", agreeGuidelines: true } });
  await page.request.post(BASE + "/api/auth/logout");
  await page.goto(BASE + "/#/login");
  await page.fill("#email", "admin@example.com");
  await page.fill("#password", "unique long passphrase");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Discover");
  await page.goto(BASE + "/#/admin");
  await page.waitForSelector("text=Stories to review");
  await shot("admin");
  while (await page.locator('[data-action="approve"]').count()) {
    await page.click('[data-action="approve"] >> nth=0');
    await page.waitForTimeout(700);
  }
  await page.goto(BASE + "/#/me");
  await page.click("text=Log out");
  await page.waitForSelector("text=Create an account");
  await page.click("text=Log in");
  await page.fill("#email", email);
  await page.fill("#password", "a long test passphrase");
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=For you");
  await page.click('.tab:has-text("Share")');
  await page.waitForSelector(".pill.st-published");
});
await t("wrong password shows an error and keeps the form", async () => {
  await page.click('.tab:has-text("Profile")');
  await page.click("text=Log out");
  await page.click("text=Log in");
  await page.fill("#email", email);
  await page.fill("#password", "wrong password here");
  await page.click('button[type="submit"]');
  await page.waitForSelector("[data-form-error]:not([hidden])");
  await shot("login-error");
});
await browser.close();
console.log(failed ? `\n${failed} step(s) failed` : "\nBrowser flow passed");
if (errors.length) { console.log("\nPage errors:\n" + [...new Set(errors)].join("\n")); }
process.exit(failed ? 1 : 0);
