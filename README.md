# Hindsight

Find women who have been where you are. Read what they feared, what happened, and what they know now. Ask a question if they're open to it.

This is a complete, deployable app: a Node server with a SQLite database, real accounts, and an installable mobile web app (PWA) with onboarding, discovery, structured then-and-now stories, opt-in questions, saving, reflection, a contributor flow, and moderation.

## What's in it

**For members**
- Sign up, log in, forgot and reset password, email confirmation, change password, download your data, delete your account
- Onboarding: stage, topics, how you plan to use it, and the community guidelines
- Discover: describe your situation and get matched stories with a "why it matched" line. Without a search, a feed tailored to the interests chosen in onboarding. Filters for stage and "takes questions"
- Story page: the situation, what she tried, what happened, trade-offs, a side-by-side then and now, and what's still unresolved
- Connect: contributors choose whether to take questions, their reply window, format, and off-limits topics. Readers send one question at a time, anonymous or by first name. Contributors can reply, decline, or decline and block
- Reflect and Saved: reactions and notes on each story, and a saved list
- Inbox with received and sent questions and a badge for new replies
- Report a story; light, dark and system themes; offline-capable app shell

**For contributors**
- A six-step story form with a live preview, draft saving on the device, and privacy controls (anonymous or first name, a pledge to remove identifying names, question settings you can change any time)
- Contact details (emails, phone numbers, links, handles) are rejected in stories so people use consent-based questions instead
- Stories are reviewed before they go live, and edits are reviewed again

**For moderators** (emails listed in `ADMIN_EMAILS`)
- Review queue with approve, or reject with a note the contributor sees
- Reports queue with dismiss or unpublish
- Stats, and one button to remove the labeled example stories

**Safety and privacy**
- Passwords hashed with bcrypt, sessions in an httpOnly SameSite cookie (hashed in the database), cookie `Secure` in production
- Rate limits on failed logins, signups, and questions (5 per person per day), origin checks on writes, a strict content security policy, no third-party scripts or fonts
- Emails are never shown to other members; saved stories and reflections are private
- Account deletion removes everything the person created

## Run it locally

```bash
npm install
npm start
# open http://localhost:3000
```

On first start the database is created in `./data` and six clearly labeled **example stories** are loaded so the app isn't empty. To make yourself a moderator, set `ADMIN_EMAILS=you@example.com`, then sign up with that email. In development, emails (confirmation, password reset) are printed in the server log.

```bash
npm test                                  # API tests (21 checks, in-memory database)
BASE=http://localhost:3000 node test/e2e.mjs   # browser test on a phone-sized screen (needs Playwright)
```

## Put it online

The app is one process plus one SQLite file, so it needs a host with a **persistent disk** and a **single instance**.

1. Push this folder to a GitHub repository.
2. Create a web service on Render, Fly.io, Railway, or any Docker host. The included `Dockerfile` works as is.
3. Attach a persistent volume mounted at `/data`.
4. Set environment variables (see `.env.example`). At minimum: `NODE_ENV=production`, `APP_URL` (your https address), `ADMIN_EMAILS`, and an email provider in `SMTP_URL` (for example Resend, Postmark, or SendGrid SMTP).
5. Open the site over https, sign up with an admin email, and open Profile, then Moderation.

Notes:
- Production cookies are `Secure`, so the app must be served over https (every host above does this for you).
- When `SMTP_URL` is set, new members must confirm their email before sharing stories or sending questions. Without it, emails go to the log and confirmation isn't required.
- Back up the `/data` volume. For continuous backups, [Litestream](https://litestream.io) works well with SQLite.
- Set `SEED_SAMPLES=false` on a fresh database if you don't want the example stories at all, or remove them later from Moderation.

## Installing it as an app

- **Android (Chrome):** members see an "Install" banner on Discover and an "Install the app" item in Profile.
- **iPhone (Safari):** Share, then "Add to Home Screen". The app shows these instructions itself.
- **Desktop Chrome and Edge:** an install icon appears in the address bar.

Once installed it opens full screen with its own icon and works offline for the app shell. Stories and questions need a connection.

### App stores

The web app can be wrapped for the stores without rewriting it, using [PWABuilder](https://www.pwabuilder.com) (Google Play and Microsoft Store) or [Capacitor](https://capacitorjs.com) (iOS and Android). You need your own Apple Developer and Google Play accounts, and Apple generally expects an app to offer more than a website in a frame, so plan for native features such as push notifications. Both stores require a privacy policy URL, in-app account deletion, and a way to report and block user-generated content. All three already exist in this app.

## Before you launch

- **Legal.** The Terms, Privacy Policy and Community Guidelines in `public/js/views-auth.js` are plain-language drafts, not legal advice. Have a lawyer review them, and set `SUPPORT_EMAIL` so people can reach you.
- **Moderation is a people job.** Stories are about sensitive decisions. Decide who reviews submissions and reports, and how fast. The guidelines point people to emergency services and 988 (US) for crisis support, so adjust that for the places you serve.
- **Seed real stories.** The product depends on contributors. Invite 10 to 20 people to write real stories before opening it up, then remove the examples.
- **Matching is keyword-based.** Search uses stemming, synonyms and tag weighting. It's explainable and works for a small library. Semantic or AI matching is a good next step once you have enough stories to justify it.

## Not included yet

- Push notifications (members see badges and the Inbox when they open the app)
- Real-time chat. Questions are asynchronous by design
- Multiple server instances (SQLite). Move to Postgres if you need to scale out
- Admin tools for suspending members. Moderation covers stories and reports

## Project layout

```
server/        Express API: auth.js, api.js, db.js (schema and example stories), util.js
public/        The app: index.html, manifest, service worker, icons, fonts
public/js/     core.js, router.js, and one file per area (auth, main, share, inbox, me)
test/          api.test.js and e2e.mjs
Dockerfile     Production image
```
