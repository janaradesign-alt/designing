"use strict";
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, "hindsight.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const SCHEMA_VERSION = 1;

function migrate() {
  const v = db.pragma("user_version", { simple: true });
  if (v >= SCHEMA_VERSION) return;
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      stage TEXT,
      topics TEXT NOT NULL DEFAULT '[]',
      intent TEXT,
      onboarded INTEGER NOT NULL DEFAULT 0,
      agreed_terms_at INTEGER,
      email_verified_at INTEGER,
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);

    CREATE TABLE tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );

    CREATE TABLE stories (
      id INTEGER PRIMARY KEY,
      author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      is_sample INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      moderation_note TEXT,
      title TEXT NOT NULL,
      lede TEXT NOT NULL,
      stage TEXT NOT NULL,
      outcome TEXT NOT NULL,
      tone TEXT NOT NULL,
      who TEXT NOT NULL DEFAULT '',
      identity_mode TEXT NOT NULL DEFAULT 'anonymous',
      display_name TEXT NOT NULL DEFAULT '',
      when_label TEXT NOT NULL,
      then_tag TEXT NOT NULL,
      written_label TEXT NOT NULL,
      situation TEXT NOT NULL,
      tried TEXT NOT NULL DEFAULT '[]',
      happened TEXT NOT NULL,
      gave TEXT NOT NULL DEFAULT '[]',
      cost TEXT NOT NULL DEFAULT '[]',
      pairs TEXT NOT NULL DEFAULT '[]',
      unresolved TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      allow_questions INTEGER NOT NULL DEFAULT 0,
      reply_window TEXT NOT NULL DEFAULT 'about 2 weeks',
      reply_format TEXT NOT NULL DEFAULT 'Written replies only',
      topics_welcome TEXT NOT NULL DEFAULT '[]',
      off_limits TEXT NOT NULL DEFAULT '',
      contrast_id INTEGER,
      contrast_line TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      published_at INTEGER
    );
    CREATE INDEX idx_stories_status ON stories(status);
    CREATE INDEX idx_stories_author ON stories(author_id);

    CREATE TABLE saves (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, story_id)
    );

    CREATE TABLE reflections (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      picks TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, story_id)
    );

    CREATE TABLE questions (
      id INTEGER PRIMARY KEY,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      asker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      ident TEXT NOT NULL DEFAULT 'anonymous',
      status TEXT NOT NULL DEFAULT 'pending',
      reply_body TEXT,
      created_at INTEGER NOT NULL,
      replied_at INTEGER,
      author_seen INTEGER NOT NULL DEFAULT 0,
      asker_seen INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_questions_story ON questions(story_id);
    CREATE INDEX idx_questions_asker ON questions(asker_id);

    CREATE TABLE reports (
      id INTEGER PRIMARY KEY,
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );

    CREATE TABLE blocks (
      blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );
  `);
  db.pragma("user_version = " + SCHEMA_VERSION);
}
migrate();

const now = () => Date.now();
const j = (v) => JSON.stringify(v == null ? [] : v);

/* ---------- Sample stories (clearly labeled as examples in the app) ---------- */
const SAMPLES = [
  {
    key: "priya", name: "Priya", who: "Neuroscience PhD student, now a UX researcher at a health nonprofit",
    stage: "PhD", tone: "mixed", outcome: "Left with a master’s degree",
    title: "I left my PhD in year three",
    lede: "I stopped, finished a master’s, and moved into research outside academia. I still think about the timing.",
    tags: ["Leaving a PhD", "Academia vs industry", "Burnout", "Advisor relationship"],
    when: "Decided in year 3 of 6", thenTag: "Year 3", written: "2 years later",
    situation: "My project had stalled twice and my advisor was on sabbatical for most of year three. I was reading job postings at night and feeling guilty about it.",
    tried: ["Talked to two older students who had left", "Booked a meeting with the program director", "Spent four weeks interviewing people who do UX research"],
    happened: "I told my advisor in March and left that August with a master’s degree. My job search took seven months, longer than I expected, and the first offer paid less than my postdoc-track peers were making.",
    gave: ["Work with clear deadlines and feedback", "A sense that my skills were portable"],
    cost: ["Seven months of searching", "Two friendships from the lab faded", "A pay cut in the first year"],
    pairs: [
      { label: "About leaving", then: "Leaving would mean I wasn’t cut out for hard things.", now: "Leaving was a decision about fit. What I found hard was mostly the structure, not the work." },
      { label: "About my options", then: "If I left, academia would be closed to me for good.", now: "It isn’t closed. I’ve stopped wanting to go back, and two people from my cohort did return." },
      { label: "About how it would look", then: "Nobody would take an unfinished PhD seriously.", now: "Nobody has asked about it since my first interviews. My methods experience mattered more." }
    ],
    unresolved: "I wish I had talked to the program director in year two instead of year three. I can’t say whether a different advisor would have changed my answer.",
    ask: true, window: "about 2 weeks", format: "Written replies", welcome: ["How I decided", "Telling my advisor", "The first job search"], off: "Names of people or institutions",
    identity: "first_name", contrast: "camille", contrastLine: "Camille faced a similar breaking point with her advisor and stayed."
  },
  {
    key: "camille", name: "Camille", who: "Chemistry PhD graduate, now a postdoc",
    stage: "PhD", tone: "mixed", outcome: "Finished the degree",
    title: "I almost left, and I stayed",
    lede: "A difficult advisor nearly ended it for me. Staying cost more than I planned, and I’m still unsure it was worth it.",
    tags: ["Staying in a PhD", "Advisor relationship", "Imposter feelings", "Academia vs industry"],
    when: "Decided in year 4 of 5", thenTag: "Year 4", written: "1 year after finishing",
    situation: "My advisor rarely gave feedback and then criticized drafts in group meetings. I stopped sharing work until it felt finished, which made everything slower.",
    tried: ["Asked my committee chair to attend progress meetings", "Started a writing group with two other students", "Summarized feedback in an email after every meeting"],
    happened: "My committee chair began running my yearly review, which changed how my advisor behaved. I defended in the spring of year five.",
    gave: ["The degree", "A committee member who became a real mentor", "Confidence in my own judgment"],
    cost: ["Two years of low energy", "A relationship I still can’t describe warmly", "Time I had planned to spend elsewhere"],
    pairs: [
      { label: "About the problem", then: "If I worked harder, my advisor would eventually respond differently.", now: "Effort didn’t change the dynamic. Changing the structure around me did." },
      { label: "About asking for help", then: "Going to my committee would look like complaining.", now: "They were relieved I asked. Most of them had seen it before." },
      { label: "About finishing", then: "The degree would make the experience feel worth it.", now: "It helped, but what felt valuable was learning to set boundaries." }
    ],
    unresolved: "I still wonder what the same years would have looked like outside academia.",
    ask: true, window: "about a month", format: "Written replies only", welcome: ["Involving a committee", "The last two years"], off: "Anything that could identify my advisor or lab",
    identity: "anonymous", contrast: "priya", contrastLine: "Priya reached a similar point and left in year three."
  },
  {
    key: "rosa", name: "Rosa", who: "Public health postdoc, now a data scientist at a health tech company",
    stage: "Postdoc", tone: "unresolved", outcome: "Chose industry, still weighing it",
    title: "A faculty search or an industry offer",
    lede: "I took the industry job. I like it, and I miss teaching more than I predicted.",
    tags: ["Academia vs industry", "Postdoc", "Changing careers"],
    when: "Decided in postdoc year 2", thenTag: "Postdoc year 2", written: "18 months later",
    situation: "I had a faculty interview scheduled and an industry offer with a two-week deadline. My partner and I also wanted to stay in one city.",
    tried: ["Listed what a typical week looks like in each job", "Asked three people in each path what surprised them", "Negotiated my start date so I could finish a grant report"],
    happened: "I withdrew from the faculty search and started in industry. The data is larger and the pace is faster. I now teach one weekend workshop each term.",
    gave: ["Higher, steadier income", "Staying in one city with my partner", "Faster project cycles"],
    cost: ["Daily contact with students", "The title I had planned around for ten years", "Time to write about my own questions"],
    pairs: [
      { label: "About the decision", then: "This was a choice between two careers, and one of them was right.", now: "Both would have been fine. I was really choosing what I wanted my weeks to feel like." },
      { label: "About my mentors", then: "Leaving would disappoint the people who trained me.", now: "They asked good questions and then helped me prepare for interviews." },
      { label: "About money", then: "The salary difference shouldn’t matter to me.", now: "It mattered more than I admitted, and it made some decisions at home easier." }
    ],
    unresolved: "I miss teaching, and I can’t tell yet whether a weekend workshop is enough.",
    ask: true, window: "about 10 days", format: "Written replies, or a short call", welcome: ["Comparing weeks in each job", "Negotiating a start date"], off: "Specific salary numbers",
    identity: "first_name", contrast: "lena", contrastLine: "Lena weighed a stable path against a change earlier in her career."
  },
  {
    key: "aisha", name: "Aisha", who: "Public policy master’s student",
    stage: "Master’s", tone: "unresolved", outcome: "Still working through it",
    title: "Everyone else seemed to belong",
    lede: "A year in, the feeling hasn’t gone away. It has gotten smaller and easier to talk about.",
    tags: ["Imposter feelings", "Master’s"],
    when: "Began in her first semester", thenTag: "First semester", written: "at the end of first year",
    situation: "In my first seminar I didn’t speak for six weeks. I assumed my admission had been a mistake that someone would eventually notice.",
    tried: ["Told one classmate how I felt", "Set a rule to say one thing per seminar", "Asked a professor in office hours what a good contribution looks like"],
    happened: "My classmate said she felt the same way. The one-comment rule felt awful in October and ordinary by March.",
    gave: ["Practice speaking while uncertain", "Two close friends in the program"],
    cost: ["A semester spent mostly in my head", "Some opportunities I was too quiet to ask about"],
    pairs: [
      { label: "About belonging", then: "People who belong don’t feel like this.", now: "Several people who clearly belonged felt exactly like this." },
      { label: "About how long it takes", then: "I would feel confident after the first set of grades.", now: "The grades helped less than I expected. Speaking up helped more." },
      { label: "About telling people", then: "Saying it out loud would confirm it.", now: "Saying it to one person made it smaller." }
    ],
    unresolved: "The feeling returned when I started my summer internship search. I don’t think it’s finished.",
    ask: false, window: "about 2 weeks", format: "Written replies only", welcome: [], off: "",
    identity: "anonymous", contrast: "camille", contrastLine: "Camille also doubted whether she belonged, and describes what changed for her."
  },
  {
    key: "lena", name: "Lena", who: "Former high school teacher, now a product designer",
    stage: "Early career", tone: "positive", outcome: "Switched fields",
    title: "Leaving teaching for design",
    lede: "It took fourteen months and most of my savings. I would do it again, with a longer runway.",
    tags: ["Changing careers", "Early career", "Money and risk"],
    when: "Decided at 27, after 5 years of teaching", thenTag: "Age 27", written: "3 years later",
    situation: "I was good at teaching and worn out by it. I had an idea for a portfolio, no portfolio yet, and about nine months of savings.",
    tried: ["Took an evening design course while still teaching", "Built three case studies from real school problems", "Applied to more than 80 roles and tracked every response in a spreadsheet"],
    happened: "I left teaching in June and freelanced for small clients. I accepted a junior role in month fourteen, at a salary close to what I earned teaching.",
    gave: ["Work that fits how I think", "A path with room to grow", "Skills I use in unexpected places"],
    cost: ["Fourteen months of uncertain income", "Most of my savings", "The daily meaning I found in classrooms"],
    pairs: [
      { label: "About starting over", then: "At 27 I would be too old to be a junior again.", now: "Nobody cared. My teaching experience made me the person who could run workshops." },
      { label: "About readiness", then: "I should wait until my portfolio was perfect.", now: "The portfolio improved faster once real people were reacting to it." },
      { label: "About money", then: "Nine months of savings would be plenty.", now: "It wasn’t. I took a part-time tutoring job in month ten." }
    ],
    unresolved: "I don’t know whether I would have gotten here faster by leaving earlier, or whether I needed those five years.",
    ask: true, window: "about 2 weeks", format: "Written replies", welcome: ["Building a first portfolio", "Budgeting a career change"], off: "Employer names",
    identity: "first_name", contrast: "rosa", contrastLine: "Rosa compared two established careers at a later stage and chose the steadier one."
  },
  {
    key: "dani", name: "Dani", who: "Started a ceramics studio after undergrad, now a project coordinator",
    stage: "Early career", tone: "mixed", outcome: "Closed the business after two years",
    title: "I started a business instead of applying to grad school",
    lede: "It closed after two years. I’m not sure I would call it a failure.",
    tags: ["Starting a business", "Early career", "Money and risk"],
    when: "Decided just after graduating", thenTag: "Just after graduating", written: "4 years later",
    situation: "I had a grad school acceptance and a lease on a small studio space. I deferred the acceptance and then let it expire.",
    tried: ["Sold at three markets before signing the lease", "Tracked every cost, including my own hours", "Asked a former business owner to review my numbers at month six"],
    happened: "Sales grew every season but never covered the lease and materials. I closed in month 26 and sold my kiln to another potter.",
    gave: ["Skills in pricing, marketing, and bookkeeping", "A community of other makers", "Proof I could carry something from start to finish"],
    cost: ["Most of what I had saved", "The grad school place", "Two years of very uneven income"],
    pairs: [
      { label: "About risk", then: "Deferring meant I could undo this if it went wrong.", now: "The place expired, and the risk was larger than I admitted." },
      { label: "About failing", then: "Closing would mean I had wasted two years.", now: "It hurt, and I use what I learned every week. I wouldn’t call it wasted." },
      { label: "About what I wanted", then: "I wanted to run a business.", now: "I wanted to make things and be around people who did. A business was one way to get that." }
    ],
    unresolved: "I haven’t decided whether I would try again.",
    ask: true, window: "about 3 weeks", format: "Written replies", welcome: ["Reading your numbers honestly", "Closing a business"], off: "Family finances",
    identity: "first_name", contrast: "lena", contrastLine: "Lena also left a settled path and describes how she budgeted for it."
  }
];

function seedSamples() {
  const t = now();
  const ids = {};
  const ins = db.prepare(`INSERT INTO stories (author_id,is_sample,status,title,lede,stage,outcome,tone,who,identity_mode,display_name,
    when_label,then_tag,written_label,situation,tried,happened,gave,cost,pairs,unresolved,tags,allow_questions,reply_window,reply_format,
    topics_welcome,off_limits,created_at,updated_at,published_at)
    VALUES (NULL,1,'published',@title,@lede,@stage,@outcome,@tone,@who,@identity,@name,@when,@thenTag,@written,@situation,@tried,@happened,
    @gave,@cost,@pairs,@unresolved,@tags,@ask,@window,@format,@welcome,@off,@t,@t,@t)`);
  const tx = db.transaction(() => {
    for (const s of SAMPLES) {
      const r = ins.run({
        title: s.title, lede: s.lede, stage: s.stage, outcome: s.outcome, tone: s.tone, who: s.who, identity: s.identity, name: s.name,
        when: s.when, thenTag: s.thenTag, written: s.written, situation: s.situation, tried: j(s.tried), happened: s.happened,
        gave: j(s.gave), cost: j(s.cost), pairs: j(s.pairs), unresolved: s.unresolved, tags: j(s.tags), ask: s.ask ? 1 : 0,
        window: s.window, format: s.format, welcome: j(s.welcome), off: s.off, t
      });
      ids[s.key] = r.lastInsertRowid;
    }
    const upd = db.prepare("UPDATE stories SET contrast_id=?, contrast_line=? WHERE id=?");
    for (const s of SAMPLES) upd.run(ids[s.contrast], s.contrastLine, ids[s.key]);
  });
  tx();
}

function maybeSeed() {
  const n = db.prepare("SELECT COUNT(*) c FROM stories").get().c;
  if (n === 0 && process.env.SEED_SAMPLES !== "false") seedSamples();
}
maybeSeed();

module.exports = { db, now, j, seedSamples };
