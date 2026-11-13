// Bridge Outreach: a small local app for tracking investors, partners and
// conferences and communities, and drafting the email and LinkedIn message for each one.
// Nothing is ever sent from here. The founder sends every message themself.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {
  // No .env file: drafts fall back to templates.
}

const PORT = Number(process.env.PORT || 4410);
// Hosted means reachable from the internet (Render sets RENDER). Locally the app only listens on this machine.
const HOSTED = Boolean(process.env.RENDER || process.env.HOSTED);
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || here;
// Optional shared password. With none set the app is open to anyone who has the address.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const authRequired = Boolean(APP_PASSWORD);
// Drafts use the strongest writer available: Claude when an Anthropic key is set, otherwise OpenAI.
const AI_PROVIDER = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "";
const MODEL = process.env.DRAFT_MODEL || (AI_PROVIDER === "openai" ? "gpt-6-astra" : "claude-fable-5-2");
const aiEnabled = Boolean(AI_PROVIDER);

// Gmail is optional. It needs an OAuth client the founder creates in Google Cloud.
const GOOGLE_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const gmailConfigured = Boolean(GOOGLE_ID && GOOGLE_SECRET);
const GOOGLE_REDIRECT = `${PUBLIC_URL}/auth/google/callback`;
// compose: create drafts. readonly: see that a draft was sent and that a reply came in.
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

// Lead finding goes through the Glasser CLI, which holds its own key and charges per lookup.
// The copy installed with the app is used when present; otherwise the one installed on this Mac.
const GLASSER_BIN =
  process.env.GLASSER_BIN ||
  [path.join(here, "node_modules", ".bin", "glasser"), "/opt/homebrew/bin/glasser"].find((p) => fs.existsSync(p)) ||
  "";
// Hosted, the key comes from GLASSER_API_KEY; locally it is in the tool's own key store.
const leadsEnabled = Boolean(GLASSER_BIN) && (!HOSTED || Boolean(process.env.GLASSER_API_KEY));
// Listed prices, shown to the founder before a search runs. The real charge comes back with each result.
const PRICE_PER_FIRM = 0.06;     // Fundable investor search, per firm returned
const PRICE_PER_LOOKUP = 0.0245; // Prospeo people search (per call) and email unlock (per person found)

const KINDS = ["investor", "partner", "conference", "community"];
const STAGES = ["Research", "Ready", "Contacted", "Replied", "Meeting", "Passed"];
const FIELDS = [
  "kind", "org", "name", "role", "email", "linkedin", "website", "fit", "warm_path",
  "stage", "notes", "email_subject", "email_body", "li_note", "li_message",
];

// ---------- database ----------

const db = new DatabaseSync(path.join(DATA_DIR, "outreach.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'investor',
    org TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    linkedin TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    fit TEXT NOT NULL DEFAULT '',
    warm_path TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'Research',
    notes TEXT NOT NULL DEFAULT '',
    email_subject TEXT NOT NULL DEFAULT '',
    email_body TEXT NOT NULL DEFAULT '',
    li_note TEXT NOT NULL DEFAULT '',
    li_message TEXT NOT NULL DEFAULT '',
    last_contacted TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    summary TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- The latest paid search on each tab, kept so a reload or tab switch never throws away results that cost money.
  CREATE TABLE IF NOT EXISTS lead_results (kind TEXT PRIMARY KEY, rows TEXT NOT NULL, search TEXT NOT NULL, at TEXT NOT NULL);
  -- Every lead any search has ever returned, one row per organisation and person.
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    org TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    linkedin TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    fit TEXT NOT NULL DEFAULT '',
    email_available INTEGER NOT NULL DEFAULT 0,
    search TEXT NOT NULL DEFAULT '',
    found_at TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    times_found INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX IF NOT EXISTS leads_unique ON leads (kind, lower(org), lower(name));
`);

// Adds new leads and refreshes ones found before, keeping any detail the new search left blank.
function storeLeads(rows, searchLabel) {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO leads (kind, org, name, role, linkedin, website, fit, email_available, search, found_at, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, lower(org), lower(name)) DO UPDATE SET
      role = CASE WHEN excluded.role <> '' THEN excluded.role ELSE role END,
      linkedin = CASE WHEN excluded.linkedin <> '' THEN excluded.linkedin ELSE linkedin END,
      website = CASE WHEN excluded.website <> '' THEN excluded.website ELSE website END,
      fit = CASE WHEN excluded.fit <> '' THEN excluded.fit ELSE fit END,
      email_available = max(email_available, excluded.email_available),
      seen_at = excluded.seen_at,
      times_found = times_found + 1`);
  for (const r of rows) {
    const org = String(r.org || "").trim(), name = String(r.name || "").trim();
    if (!org && !name) continue;
    if (isBlocked(r)) continue;
    upsert.run(r.kind || "investor", org, name, String(r.role || ""), String(r.linkedin || ""), String(r.website || ""),
      String(r.fit || ""), r.email_available ? 1 : 0, String(searchLabel || "").slice(0, 300), now, now);
  }
}

// Leads found before this table existed live only in the saved per-tab results; copy them in once.
if (!db.prepare("SELECT 1 FROM leads LIMIT 1").get()) {
  for (const r of db.prepare("SELECT * FROM lead_results").all()) {
    const search = JSON.parse(r.search);
    storeLeads(JSON.parse(r.rows), search.query || search.keywords || "");
  }
}

function saveLeadResults(kind, rows, search) {
  db.prepare("INSERT INTO lead_results (kind, rows, search, at) VALUES (?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET rows = excluded.rows, search = excluded.search, at = excluded.at")
    .run(kind, JSON.stringify(rows), JSON.stringify(search), new Date().toISOString());
}

function leadResults() {
  const out = {};
  for (const r of db.prepare("SELECT * FROM lead_results").all()) {
    out[r.kind] = { rows: JSON.parse(r.rows), search: JSON.parse(r.search), at: r.at };
  }
  return out;
}
if (!db.prepare("PRAGMA table_info(contacts)").all().some((col) => col.name === "gmail_draft_at")) {
  db.exec("ALTER TABLE contacts ADD COLUMN gmail_draft_at TEXT");
}
// The next follow-up for someone who has not replied yet.
if (!db.prepare("PRAGMA table_info(contacts)").all().some((col) => col.name === "followup_body")) {
  db.exec("ALTER TABLE contacts ADD COLUMN followup_subject TEXT NOT NULL DEFAULT ''");
  db.exec("ALTER TABLE contacts ADD COLUMN followup_body TEXT NOT NULL DEFAULT ''");
}
const MAX_FOLLOWUPS = 3;
const addColumn = (table, column, definition) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
};
for (const table of ["contacts", "leads"]) {
  addColumn(table, "dream", "INTEGER NOT NULL DEFAULT 0");
  addColumn(table, "why_now", "TEXT NOT NULL DEFAULT ''");
  addColumn(table, "why_now_sources", "TEXT NOT NULL DEFAULT '[]'");
  addColumn(table, "researched_at", "TEXT");
}
addColumn("contacts", "email_available", "INTEGER NOT NULL DEFAULT 0");
addColumn("contacts", "review", "TEXT NOT NULL DEFAULT ''");          // '', pending, approved, snoozed, dismissed
addColumn("contacts", "snooze_until", "TEXT");
addColumn("contacts", "gmail_thread_id", "TEXT NOT NULL DEFAULT ''");
addColumn("contacts", "gmail_message_id", "TEXT NOT NULL DEFAULT ''");
// One row per message sent, so the app can learn which kinds of message get replies.
db.exec(`CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, kind TEXT, level INTEGER, category TEXT,
  warm INTEGER, why_now INTEGER, followup_n INTEGER, subject TEXT, opener TEXT, at TEXT NOT NULL, replied INTEGER NOT NULL DEFAULT 0
)`);

// ---------- scoring and tiers ----------

// Category comes from the person's role; the score adds up signals that make a lead worth reaching first.
const DECIDER = /\b(founder|co-?founder|ceo|chief|president|owner|managing (partner|director)|general partner|gp|partner|principal|head|vp|vice president|director|chair)\b/i;
const INFLUENCER = /\b(manager|lead|senior|sr\.?|associate|investor|analyst|program|producer|curator|coordinator|organi[sz]er|events?|community|partnerships?)\b/i;
const LEVELS = { 1: "Dream", 2: "Strong", 3: "Fit", 4: "Not now" };
function rate(l) {
  const why = [];
  let score = 0;
  let category = "Firm only";
  if (l.name) {
    if (DECIDER.test(l.role || "")) { category = "Decision maker"; score += 35; why.push("Decision maker role +35"); }
    else if (INFLUENCER.test(l.role || "")) { category = "Influencer"; score += 22; why.push("Influencer role +22"); }
    else { category = "Contact"; score += 12; why.push("Named contact +12"); }
    if (l.linkedin) { score += 15; why.push("LinkedIn profile +15"); }
    if (l.email_available || l.email) { score += 20; why.push("Email available +20"); }
  } else {
    score += 5; why.push("Organisation only, no person yet +5");
  }
  if ((l.fit || "").trim().length > 10) { score += 15; why.push("Clear reason they fit +15"); }
  if ((l.why_now || "").trim()) { score += 10; why.push("Timely reason to write now +10"); }
  if (l.warm_path) { score += 10; why.push("Warm introduction +10"); }
  if (l.website) { score += 5; why.push("Website known +5"); }
  const repeats = Math.min(Math.max((l.times_found || 1) - 1, 0), 2);
  if (repeats) { score += repeats * 5; why.push(`Found by ${repeats + 1} searches +${repeats * 5}`); }
  score = Math.min(score, 100);
  const tier = score >= 70 ? "Hot" : score >= 45 ? "Warm" : "Cold";
  const level = l.dream ? 1 : score >= 85 ? 1 : score >= 70 ? 2 : score >= 45 ? 3 : 4;
  if (l.dream) why.unshift("Marked as a dream target");
  return { score, tier, category, why, level, levelName: LEVELS[level] };
}
const followupsSent = (id) => db.prepare("SELECT count(*) AS n FROM activity WHERE contact_id = ? AND summary LIKE 'Follow-up%'").get(id).n;

const DEFAULT_SETTINGS = {
  founder_name: "",
  founder_title: "Founder",
  company: "thebridge",
  pitch:
    "thebridge is an AI R&D lab studying how groups think together. Our product, roundtable, brings up to six people together for a focused conversation. Nova, our AI co-host, helps find the right people, supports the room when invited, and turns what mattered into next steps.",
  investor_ask: "A 20 minute conversation, or a seat at a small roundtable we are hosting on how AI changes group decisions.",
  partner_ask: "A short call to explore running a pilot roundtable with your team or community.",
  conference_ask: "A speaking slot or a hosted roundtable session at your event.",
  community_ask: "A free roundtable session for a few of your members, so they can try it and tell us what works.",
  proof: "",
  link: "https://thebridge.ai",
  followup_days: "5",
  voice_samples: "",
  booking_link: "",
  block_list: "",
  daily_research_cap: "20",
};
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

const now = () => new Date().toISOString();
const getSettings = () =>
  Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, r.value]));
const getContact = (id) => db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);

function clean(input) {
  const out = {};
  for (const field of FIELDS) {
    if (input[field] === undefined || input[field] === null) continue;
    out[field] = String(input[field]).trim();
  }
  if (out.kind && !KINDS.includes(out.kind)) out.kind = "investor";
  if (out.stage && !STAGES.includes(out.stage)) out.stage = "Research";
  return out;
}

// Both statements are fixed text covering every editable column, in FIELDS order.
// Values are always bound as parameters; a null leaves the column unchanged on update.
const INSERT_CONTACT = db.prepare(`
  INSERT INTO contacts (
    kind, org, name, role, email, linkedin, website, fit, warm_path,
    stage, notes, email_subject, email_body, li_note, li_message, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const UPDATE_CONTACT = db.prepare(`
  UPDATE contacts SET
    kind = COALESCE(?, kind), org = COALESCE(?, org), name = COALESCE(?, name),
    role = COALESCE(?, role), email = COALESCE(?, email), linkedin = COALESCE(?, linkedin),
    website = COALESCE(?, website), fit = COALESCE(?, fit), warm_path = COALESCE(?, warm_path),
    stage = COALESCE(?, stage), notes = COALESCE(?, notes),
    email_subject = COALESCE(?, email_subject), email_body = COALESCE(?, email_body),
    li_note = COALESCE(?, li_note), li_message = COALESCE(?, li_message),
    updated_at = ?
  WHERE id = ?`);

function insertContact(input) {
  const data = clean(input);
  const defaults = { kind: "investor", stage: "Research" };
  const stamp = now();
  const result = INSERT_CONTACT.run(...FIELDS.map((f) => data[f] ?? defaults[f] ?? ""), stamp, stamp);
  return getContact(Number(result.lastInsertRowid));
}

function updateContact(id, input) {
  const data = clean(input);
  UPDATE_CONTACT.run(...FIELDS.map((f) => data[f] ?? null), now(), id);
  return getContact(id);
}

// Records something that happened with a contact and moves their stage to match.
const CHANNEL_LABELS = {
  email: "Email sent",
  linkedin_note: "LinkedIn connection request sent",
  linkedin_message: "LinkedIn message sent",
  reply: "They replied",
  meeting: "Meeting booked",
  note: "Note",
};

function logEvent(contact, channel, summary) {
  const stamp = now();
  db.prepare("INSERT INTO activity (contact_id, channel, summary, at) VALUES (?, ?, ?, ?)")
    .run(contact.id, channel, summary || CHANNEL_LABELS[channel], stamp);
  const outbound = ["email", "linkedin_note", "linkedin_message"].includes(channel);
  const nextStage =
    channel === "meeting" ? "Meeting"
    : channel === "reply" ? (contact.stage === "Meeting" ? "Meeting" : "Replied")
    : outbound && ["Research", "Ready"].includes(contact.stage) ? "Contacted"
    : contact.stage;
  db.prepare("UPDATE contacts SET stage = ?, last_contacted = COALESCE(?, last_contacted), updated_at = ? WHERE id = ?")
    .run(nextStage, outbound ? stamp : null, stamp, contact.id);
  if (channel === "email") {
    const followupN = Number((/^Follow-up (\d)/.exec(summary || "") || [])[1] || 0);
    const r = rate(contact);
    const body = followupN ? contact.followup_body : contact.email_body;
    const opener = String(body || "").split("\n").map((l) => l.trim()).filter((l) => l && !/^(hi|hello|hey|dear)\b/i.test(l))[0] || "";
    db.prepare("INSERT INTO sends (contact_id, kind, level, category, warm, why_now, followup_n, subject, opener, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(contact.id, contact.kind, r.level, r.category, contact.warm_path ? 1 : 0, contact.why_now ? 1 : 0, followupN,
        followupN ? contact.followup_subject : contact.email_subject, opener.slice(0, 300), stamp);
  }
  if (channel === "reply") {
    // The reply is credited to the last message they received, and the sequence stops.
    db.prepare("UPDATE sends SET replied = 1 WHERE id = (SELECT id FROM sends WHERE contact_id = ? ORDER BY at DESC LIMIT 1)").run(contact.id);
    db.prepare("UPDATE contacts SET review = '', followup_subject = '', followup_body = '' WHERE id = ?").run(contact.id);
  }
}

// ---------- Gmail ----------

const getSecret = (key) => db.prepare("SELECT value FROM secrets WHERE key = ?").get(key)?.value || "";
const setSecret = (key, value) =>
  db.prepare("INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
const clearGmail = () => db.prepare("DELETE FROM secrets WHERE key LIKE 'gmail_%'").run();
const gmailConnected = () => Boolean(getSecret("gmail_refresh_token"));
const EMAIL_PATTERN = /^[^\s@"<>(){},;:]+@[^\s@"<>(){},;:]+\.[^\s@"<>(){},;:]+$/;
let oauthState = "";
let lastSync = 0;

async function googleToken(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Google sign-in failed.");
  return data;
}

async function gmailAccessToken() {
  if (!gmailConnected()) throw new Error("Gmail is not connected.");
  const expires = Number(getSecret("gmail_expires_at"));
  if (getSecret("gmail_access_token") && expires > Date.now() + 60_000) return getSecret("gmail_access_token");
  let data;
  try {
    data = await googleToken({ grant_type: "refresh_token", refresh_token: getSecret("gmail_refresh_token") });
  } catch {
    clearGmail();
    throw new Error("The Gmail connection expired. Connect Gmail again on the Your pitch page.");
  }
  setSecret("gmail_access_token", data.access_token);
  setSecret("gmail_expires_at", String(Date.now() + data.expires_in * 1000));
  return data.access_token;
}

async function gmail(pathAndQuery, options = {}) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${pathAndQuery}`, {
    ...options,
    headers: { Authorization: `Bearer ${await gmailAccessToken()}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gmail request failed.");
  return data;
}

async function createGmailDraft(contact) {
  if (!EMAIL_PATTERN.test(contact.email)) throw new Error("This contact needs a valid email address first.");
  if (!contact.email_body.trim()) throw new Error("Write the draft first.");
  const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
  const subject = contact.email_subject.replace(/[\r\n]+/g, " ").trim();
  const message = [
    `To: ${contact.email}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(contact.email_body).replace(/(.{76})/g, "$1\r\n"),
  ].join("\r\n");
  await gmail("drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw: Buffer.from(message, "utf8").toString("base64url") } }),
  });
  db.prepare("UPDATE contacts SET gmail_draft_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), contact.id);
}

const sentToday = () => db.prepare("SELECT count(*) AS n FROM activity WHERE channel = 'email' AND at >= ?").get(today()).n;
const MAX_SENDS_PER_DAY = 40;

// Sends from the connected Gmail. Follow-ups go into the same thread as the first email.
async function sendGmail(c, { subject, body, followup }) {
  if (!EMAIL_PATTERN.test(c.email)) throw new Error("This contact needs a valid email address first.");
  if (!String(body || "").trim()) throw new Error("There is nothing to send yet.");
  if (sentToday() >= MAX_SENDS_PER_DAY) throw new Error(`${MAX_SENDS_PER_DAY} emails sent today already. Gmail limits new senders; send the rest tomorrow.`);
  const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
  const subj = String(subject || "").replace(/[\r\n]+/g, " ").trim();
  const headers = [`To: ${c.email}`, `Subject: =?UTF-8?B?${b64(subj)}?=`, "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"];
  if (followup && c.gmail_message_id) headers.push(`In-Reply-To: ${c.gmail_message_id}`, `References: ${c.gmail_message_id}`);
  const raw = Buffer.from([...headers, "", b64(body).replace(/(.{76})/g, "$1\r\n")].join("\r\n"), "utf8").toString("base64url");
  const sent = await gmail("messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, ...(followup && c.gmail_thread_id ? { threadId: c.gmail_thread_id } : {}) }),
  });
  if (!followup) {
    const meta = await gmail(`messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`);
    const messageId = (meta.payload?.headers || []).find((h) => h.name.toLowerCase() === "message-id")?.value || "";
    db.prepare("UPDATE contacts SET gmail_thread_id = ?, gmail_message_id = ? WHERE id = ?").run(sent.threadId || "", messageId, c.id);
  }
  return sent;
}

// Looks in Gmail for two things: drafts that have since been sent, and replies from people already contacted.
async function syncGmail() {
  const found = { sent: 0, replies: 0 };
  const candidates = db
    .prepare("SELECT * FROM contacts WHERE email != '' AND stage IN ('Research', 'Ready', 'Contacted')")
    .all()
    .filter((c) => EMAIL_PATTERN.test(c.email));
  const anyMatch = async (query) =>
    Boolean((await gmail(`messages?maxResults=1&q=${encodeURIComponent(query)}`)).messages?.length);
  const epoch = (iso) => Math.floor(new Date(iso).getTime() / 1000);
  for (const c of candidates) {
    if (c.stage !== "Contacted" && c.gmail_draft_at) {
      if (await anyMatch(`in:sent to:${c.email} after:${epoch(c.gmail_draft_at) - 60}`)) {
        logEvent(c, "email", "Email sent (seen in Gmail)");
        found.sent++;
      }
    } else if (c.stage === "Contacted" && c.last_contacted) {
      if (await anyMatch(`from:${c.email} after:${epoch(c.last_contacted)}`)) {
        logEvent(c, "reply", "They replied (seen in Gmail)");
        found.replies++;
      }
    }
  }
  lastSync = Date.now();
  return found;
}

async function authRoutes(req, res, url) {
  if (!gmailConfigured) return send(res, 400, "Gmail is not set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.", "text/plain");
  if (url.pathname === "/auth/google") {
    oauthState = crypto.randomUUID();
    const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    target.search = new URLSearchParams({
      client_id: GOOGLE_ID,
      redirect_uri: GOOGLE_REDIRECT,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
      state: oauthState,
    }).toString();
    res.writeHead(302, { Location: target.href });
    return res.end();
  }
  if (url.pathname === "/auth/google/callback") {
    if (!oauthState || url.searchParams.get("state") !== oauthState) return send(res, 400, "Sign-in could not be verified. Start again from the app.", "text/plain");
    oauthState = "";
    if (url.searchParams.get("error")) {
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    const data = await googleToken({
      grant_type: "authorization_code",
      code: url.searchParams.get("code") || "",
      redirect_uri: GOOGLE_REDIRECT,
    });
    if (!data.refresh_token) return send(res, 400, "Google did not grant ongoing access. Start again from the app.", "text/plain");
    setSecret("gmail_refresh_token", data.refresh_token);
    setSecret("gmail_access_token", data.access_token);
    setSecret("gmail_expires_at", String(Date.now() + data.expires_in * 1000));
    setSecret("gmail_address", (await gmail("profile")).emailAddress || "");
    res.writeHead(302, { Location: "/" });
    return res.end();
  }
  return send(res, 404, { error: "Not found." });
}

// ---------- lead finding ----------

function glasser(args) {
  return new Promise((resolve, reject) => {
    // The tool is a Node script, so it is run with the same Node that runs this server.
    execFile(
      process.execPath,
      [fs.realpathSync(GLASSER_BIN), ...args],
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let data = null;
        try { data = JSON.parse(stdout); } catch { /* handled below */ }
        if (data) return resolve(data);
        let message = "The data service did not answer. Try again.";
        try { message = JSON.parse(stderr).error.message; } catch { /* keep the default */ }
        reject(new Error(message));
      },
    );
  });
}

// Runs one paid lookup and returns { output, charge } with the charge in dollars.
async function lookup(provider, endpoint, input) {
  const run = await glasser([
    "run", "-p", provider, "-e", endpoint, "-i", JSON.stringify(input),
    "-j", "--wait", "--idempotency-key", crypto.randomUUID(),
  ]);
  if (run.status !== "COMPLETED") {
    throw new Error(run.failure?.message || `The lookup did not finish (${String(run.status).toLowerCase()}).`);
  }
  return { output: run.output || {}, charge: Number(run.charge_usd) || 0 };
}

const rootDomain = (value) =>
  String(value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].trim();
const tidy = (value, max = 120) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

function personRow(kind, result, fit) {
  const p = result.person || {};
  const c = result.company || {};
  return {
    kind,
    org: tidy(c.name, 80),
    website: c.website || (c.domain ? `https://${c.domain}` : ""),
    name: tidy(p.full_name, 80),
    role: tidy(p.current_job_title, 90),
    linkedin: p.linkedin_url || "",
    email_available: p.email?.status === "VERIFIED",
    fit: fit ?? tidy(c.description, 220),
  };
}

// Investors: firms whose recent portfolio matches a description, then up to two partners at each.
async function findInvestors({ query, count, earlyOnly }) {
  const since = new Date();
  since.setMonth(since.getMonth() - 24);
  const portfolio = { search_query: query, deal_start_date: since.toISOString().slice(0, 10) };
  if (earlyOnly) portfolio.deal_size_max = 6_000_000;
  const firmSearch = await lookup("fundable", "/investors", {
    page_size: count,
    sort_by: "matching_deals",
    company_investments: portfolio,
  });
  let charge = firmSearch.charge;
  const firms = (firmSearch.output.data?.investors || []).map((f) => {
    const rounds = (f.top_round_types || []).slice(0, 2).map((r) => String(r.type).replaceAll("_", " ").toLowerCase());
    return {
      domain: rootDomain(f.domain || f.website),
      org: tidy(f.name, 80),
      website: f.website || "",
      fit: tidy(
        `${tidy(f.name, 80)} backed ${f.filtered_deal_count} similar ${f.filtered_deal_count === 1 ? "company" : "companies"} in the last two years` +
          (rounds.length ? `, mostly ${rounds.join(" and ")} rounds` : "") + ".",
        220,
      ),
    };
  });
  if (!firms.length) return { rows: [], charge, warning: "" };

  let people = [];
  let warning = "";
  try {
    const peopleSearch = await lookup("prospeo", "/search-person", {
      page: 1,
      filters: {
        company: { websites: { include: firms.map((f) => f.domain).filter(Boolean) } },
        // "Partner" also matches partnerships and channel roles, which are not investors.
        person_job_title: {
          include: ["Partner", "Principal", "Investor"],
          exclude: ["Partnerships", "Partnership", "Partner Manager", "Partner Success", "Channel", "Talent", "Recruiting"],
          match_mode: "CONTAINS",
        },
        max_person_per_company: 2,
      },
    });
    charge += peopleSearch.charge;
    people = peopleSearch.output.results || [];
  } catch (error) {
    warning = `Found the firms, but the people search failed (${error.message}). Firms are listed without a contact.`;
  }

  const rows = [];
  for (const firm of firms) {
    const matches = people.filter((r) => rootDomain(r.company?.domain || r.company?.website) === firm.domain);
    if (!matches.length) {
      rows.push({ kind: "investor", org: firm.org, website: firm.website, name: "", role: "", linkedin: "", email_available: false, fit: firm.fit });
    }
    for (const match of matches) rows.push({ ...personRow("investor", match, firm.fit), org: firm.org, website: firm.website });
  }
  return { rows, charge, warning };
}

// Partners, conferences and communities: people with a given role at organisations described by keywords.
async function findPeople({ kind, keywords, titles }) {
  const search = await lookup("prospeo", "/search-person", {
    page: 1,
    filters: {
      company_keywords: { include: keywords, include_all: false },
      person_job_title: { include: titles, match_mode: "CONTAINS" },
      max_person_per_company: 1,
    },
  });
  return { rows: (search.output.results || []).map((r) => personRow(kind, r)), charge: search.charge, warning: "" };
}

async function findEmail(contact) {
  const input = contact.linkedin
    ? { linkedin_url: contact.linkedin.startsWith("http") ? contact.linkedin : `https://${contact.linkedin}` }
    : { full_name: contact.name, ...(contact.website ? { company_website: rootDomain(contact.website) } : { company_name: contact.org }) };
  const result = await lookup("prospeo", "/enrich-person", input);
  const email = result.output.person?.email?.email || "";
  return { email: EMAIL_PATTERN.test(email) ? email : "", charge: result.charge };
}

const splitList = (value, max) =>
  String(value || "").split(/[,\n]/).map((s) => tidy(s, 60)).filter(Boolean).slice(0, max);

async function leadRoutes(req, res, parts) {
  if (!leadsEnabled) return send(res, 400, { error: "Lead finding is not set up on this machine." });
  if (req.method === "GET" && parts[2] === "balance") {
    const balance = await glasser(["balance", "--json"]);
    return send(res, 200, { available: balance.available_usd ?? null });
  }
  if (req.method !== "POST") return send(res, 404, { error: "Not found." });
  const body = await readJson(req);
  if (parts[2] === "plan") {
    // Turns a plain description of who to reach into search fields. The founder still runs the search.
    const text = tidy(body.text, 400);
    if (text.length < 6) return send(res, 400, { error: "Describe who you want to reach in a few words." });
    if (AI_PROVIDER !== "anthropic") return send(res, 400, { error: "Plain-words search needs an Anthropic key." });
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: [
        "You turn a founder's plain description of who they want to reach into search fields for a people database.",
        "kind is one of investor, partner, conference, community.",
        "For investor: query describes the kind of companies those investors back, written like a company description (they are matched by portfolio). Leave keywords and titles empty.",
        "For the others: keywords are 3 to 8 short words or phrases describing the organisations (industry, type, focus); titles are 3 to 8 job titles of the person to reach.",
        "Put any place or size the founder mentions into the keywords. note is one plain sentence saying what the search will look for.",
        'Return only JSON: {"kind": string, "query": string, "keywords": [string], "titles": [string], "note": string}.',
      ].join("\n"),
      messages: [{ role: "user", content: text }],
    });
    const out = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    try {
      const plan = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
      if (!KINDS.includes(plan.kind)) plan.kind = "partner";
      return send(res, 200, { plan });
    } catch {
      return send(res, 400, { error: "Could not turn that into a search. Try describing the people and the kind of organisation." });
    }
  }
  if (parts[2] === "investors") {
    const query = tidy(body.query, 300);
    if (query.length < 8) return send(res, 400, { error: "Describe what your company does in a few words." });
    const count = [5, 10, 20].includes(Number(body.count)) ? Number(body.count) : 5;
    const result = await findInvestors({ query, count, earlyOnly: body.earlyOnly !== false });
    result.rows = (result.rows || []).filter((r) => !isBlocked(r));
    if (result.rows?.length) {
      saveLeadResults("investor", result.rows, { query, count, early: body.earlyOnly !== false });
      storeLeads(result.rows, query);
    }
    return send(res, 200, { ...result, leadResults: leadResults(), allLeads: state().allLeads });
  }
  if (parts[2] === "people") {
    const keywords = splitList(body.keywords, 8);
    const titles = splitList(body.titles, 8);
    if (!keywords.length || !titles.length) return send(res, 400, { error: "Add at least one keyword and one role." });
    const kind = ["conference", "community"].includes(body.kind) ? body.kind : "partner";
    const result = await findPeople({ kind, keywords, titles });
    result.rows = (result.rows || []).filter((r) => !isBlocked(r));
    if (result.rows?.length) {
      saveLeadResults(kind, result.rows, { keywords: keywords.join(", "), titles: titles.join(", ") });
      storeLeads(result.rows, `${keywords.join(", ")} · ${titles.join(", ")}`);
    }
    return send(res, 200, { ...result, leadResults: leadResults(), allLeads: state().allLeads });
  }
  if (parts[2] === "dream") {
    db.prepare("UPDATE leads SET dream = ? WHERE id = ?").run(body.dream ? 1 : 0, Number(body.id));
    return send(res, 200, state());
  }
  if (parts[2] === "forget") {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 1000);
    const del = db.prepare("DELETE FROM leads WHERE id = ?");
    for (const id of ids) del.run(id);
    return send(res, 200, state());
  }
  if (parts[2] === "clear") {
    const kind = KINDS.includes(body.kind) ? body.kind : "";
    if (kind) db.prepare("DELETE FROM lead_results WHERE kind = ?").run(kind);
    return send(res, 200, state());
  }
  if (parts[2] === "add") {
    let added = 0, skipped = 0;
    for (const row of Array.isArray(body.rows) ? body.rows.slice(0, 100) : []) {
      const org = tidy(row.org, 80), name = tidy(row.name, 80);
      if (!org && !name) { skipped++; continue; }
      const duplicate = db
        .prepare("SELECT id FROM contacts WHERE lower(org) = lower(?) AND lower(name) = lower(?)")
        .get(org, name);
      if (duplicate) { skipped++; continue; }
      if (isBlocked({ org, name, website: row.website })) { skipped++; continue; }
      const created = insertContact({
        kind: row.kind, org, name, role: row.role, linkedin: row.linkedin, website: row.website, fit: row.fit,
        stage: "Research",
      });
      db.prepare("UPDATE contacts SET email_available = ?, dream = ?, why_now = ?, why_now_sources = ?, researched_at = ? WHERE id = ?")
        .run(row.email_available ? 1 : 0, row.dream ? 1 : 0, row.why_now || "", row.why_now_sources || "[]", row.researched_at || null, created.id);
      autopilot.enqueue(created.id);
      added++;
    }
    return send(res, 200, { added, skipped, ...state() });
  }
  return send(res, 404, { error: "Not found." });
}

// ---------- CSV ----------

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  kind: "kind", type: "kind", category: "kind",
  org: "org", company: "org", firm: "org", organization: "org", organisation: "org", fund: "org", event: "org",
  name: "name", person: "name", contact: "name", "full name": "name",
  role: "role", title: "role", position: "role",
  email: "email", "e-mail": "email",
  linkedin: "linkedin", "linkedin url": "linkedin", "linkedin profile": "linkedin",
  website: "website", url: "website", site: "website",
  fit: "fit", "why": "fit", "fit reason": "fit", thesis: "fit",
  warm_path: "warm_path", "warm path": "warm_path", intro: "warm_path", "intro path": "warm_path",
  stage: "stage", status: "stage",
  notes: "notes", note: "notes",
};

function importCsv(text, defaultKind) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, skipped: 0, error: "Need a header row and at least one data row." };
  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] || null);
  if (!header.includes("org") && !header.includes("name")) {
    return { added: 0, skipped: 0, error: "The header row needs at least an org (company) or name column." };
  }
  let added = 0, skipped = 0;
  for (const cells of rows.slice(1)) {
    const record = {};
    header.forEach((field, i) => { if (field && cells[i] !== undefined) record[field] = cells[i].trim(); });
    if (!record.org && !record.name) { skipped++; continue; }
    record.kind = KINDS.includes((record.kind || "").toLowerCase()) ? record.kind.toLowerCase() : defaultKind;
    const stage = STAGES.find((s) => s.toLowerCase() === (record.stage || "").toLowerCase());
    record.stage = stage || "Research";
    const duplicate = db
      .prepare("SELECT id FROM contacts WHERE lower(org) = lower(?) AND lower(name) = lower(?)")
      .get(record.org || "", record.name || "");
    if (duplicate) { skipped++; continue; }
    autopilot.enqueue(insertContact(record).id);
    added++;
  }
  return { added, skipped };
}

function exportCsv() {
  const cols = ["kind", "org", "name", "role", "email", "linkedin", "website", "fit", "warm_path", "stage", "notes", "last_contacted"];
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [cols.join(",")];
  for (const c of db.prepare("SELECT * FROM contacts ORDER BY kind, org").all()) {
    lines.push(cols.map((col) => esc(c[col])).join(","));
  }
  return lines.join("\n");
}

// ---------- drafting ----------

const askFor = (s, kind) =>
  kind === "partner" ? s.partner_ask : kind === "conference" ? s.conference_ask : kind === "community" ? s.community_ask : s.investor_ask;

function templateDraft(c, s) {
  const first = (c.name || "").split(" ")[0] || "there";
  const me = s.founder_name || "[your name]";
  const fit = c.fit ? c.fit.replace(/\.$/, "") : "";
  const opener =
    c.warm_path ? `${c.warm_path.replace(/\.$/, "")} suggested I reach out.`
    : fit ? `Why I'm writing to you in particular: ${fit}.`
    : c.kind === "conference" ? `I've been following ${c.org || "your event"} and would like to contribute.`
    : c.kind === "community" ? `I've been following what ${c.org || "your community"} does for its members.`
    : `I've been following ${c.org || "your work"} and think there is a fit.`;
  const ask = askFor(s, c.kind);
  const subject =
    c.kind === "investor" ? `${s.company}: how groups think together with AI`
    : c.kind === "partner" ? `${s.company} x ${c.org || "you"}: a pilot roundtable`
    : c.kind === "community" ? `A roundtable for ${c.org || "your members"}`
    : `Session idea for ${c.org || "your event"}: AI-facilitated roundtables`;
  const body = [
    `Hi ${first},`,
    "",
    opener,
    "",
    s.pitch,
    s.proof ? `\n${s.proof}` : null,
    "",
    `What I'm hoping for: ${ask}`,
    "",
    "Would you be open to that?",
    "",
    "Best,",
    me,
    [s.founder_title, s.company].filter(Boolean).join(", "),
    s.link,
  ].filter((line) => line !== null).join("\n");
  const note = `Hi ${first}, I'm ${me}, building ${s.company} (AI-facilitated roundtables for small groups). ${
    fit ? "Your work is close to what we study. " : ""
  }Would be glad to connect.`.slice(0, 295);
  const message = [
    `Hi ${first}, thanks for connecting.`,
    "",
    `${opener} ${s.company} runs roundtable: small rooms of up to six people with an AI co-host that helps the group reach shared understanding.`,
    "",
    `${ask} Open to it?`,
  ].join("\n");
  return { email_subject: subject, email_body: body, li_note: note, li_message: message };
}

// Phrases that make outreach read as templated or machine-written. A draft containing any is rewritten once.
const SLOP = [
  /hope (this|you're|you are|all is)/i, /reach(ing)? out/i, /\bleverag/i, /\bdelve/i, /\bexcited\b/i, /game[- ]chang/i,
  /\bsynerg/i, /\bseamless/i, /\bunlock/i, /revolutioni[sz]/i, /\bcame across\b/i, /\bquick question\b/i,
  /intersection of/i, /\bempower/i, /\bcutting[- ]edge\b/i, /\binnovative\b/i, /\bpassionate\b/i, /\bthrilled\b/i,
  /\bin today's\b/i, /\btouch base\b/i, /\bcircle back\b/i, /\bgroundbreaking\b/i, /\btransformative\b/i,
  /\bjourney\b/i, /\bi wanted to\b/i, /\bmy name is\b/i, /\bperfect fit\b/i, /\blove to connect\b/i, /\bpick your brain\b/i,
  /collaboration opportunity/i, /request for a meeting/i, /respected sir/i, /\bfull[- ]funnel\b/i, /\bend[- ]to[- ]end\b/i,
  /—/, /!/,
];
const slopIn = (draft) => [...new Set(SLOP.filter((re) => re.test(Object.values(draft).join(" "))).map((re) => (re.source === "—" ? "em dash" : re.source === "!" ? "exclamation mark" : re.source.replace(/\\b|\\s\?|\(\?:|\)|\\|\[|\]|\?|-/g, " ").replace(/\s+/g, " ").trim())))];

const DRAFT_SYSTEM = [
  "You write first-touch outreach as the founder, in first person, the way a busy founder actually writes to someone they respect: short, specific, a little informal, clearly typed by a person.",
  "The reader is an investor, partner, event organiser or community leader who deletes anything that smells like a template. The test of a good message: it could only have been sent to this one person, and replying takes them ten seconds.",
  "",
  "How to write it:",
  "- Open with the specific reason you are writing to them: the warm path if there is one, otherwise the recent thing in why_now if supplied, otherwise the concrete thing in why_they_fit. Never open with who you are, a pleasantry, or a compliment.",
  "- If how_the_sender_writes is supplied, those are real messages by the sender: match their tone, sentence length, greeting and sign-off habits. Never copy their sentences or facts.",
  "- If first_emails_that_got_replies is supplied, notice what those openers and subjects have in common and lean that way, without copying them.",
  "- If booking_link is supplied, put it on its own line straight after the ask, introduced in a few plain words.",
  "- Then ONE plain sentence on what thebridge does, framed as what this reader gets from it, short enough that they could repeat it to someone else. Do not paste or paraphrase the whole pitch; pick the part that matters to this reader.",
  "- If proof_points are supplied, add one sentence with the single proof point this reader would care most about. If none are supplied, write no proof sentence at all; never imply traction.",
  "- Put the ask alone on its own line: one small, specific next step phrased as a question, easy to say yes to. No menu of options.",
  "- Use contractions. Mix short and medium sentences. No lists, no bold, no headings, no buzzwords.",
  "- Sign-off: on a cold message (no warm path), the sender's first name on one line, then their title and company and one link on the next line, for example 'Adnan' then 'Founder, thebridge · thebridge.ai'. With a warm path, the first name alone is enough. Never a closing phrase like Best or Cheers, never a quote, never more than one link.",
  "- Use only the facts supplied. Never invent traction, numbers, mutual connections, or anything about the recipient. If a fact is missing, write around it.",
  "- Never use: I hope this finds you well, reaching out, I wanted to, my name is, excited, thrilled, passionate, leverage, synergy, seamless, unlock, innovative, cutting-edge, game-changer, journey, perfect fit, pick your brain, circle back, touch base. No em dashes, no exclamation marks.",
  "",
  "Lengths: email_subject 2 to 6 words, lowercase is fine, never clickbait. email_body 50 to 110 words including greeting and sign-off. li_note at most 280 characters, no sign-off. li_message under 70 words, for after they accept the connection.",
  "Return only a JSON object with the string keys email_subject, email_body, li_note, li_message.",
].join("\n");

function parseDraft(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("The model did not return a draft in the expected format.");
  const parsed = JSON.parse(text.slice(start, end + 1));
  const out = {};
  for (const key of ["email_subject", "email_body", "li_note", "li_message"]) {
    if (typeof parsed[key] !== "string" || !parsed[key].trim()) throw new Error(`The draft is missing ${key}.`);
    out[key] = parsed[key].trim();
  }
  return out;
}

async function claudeText(model, messages, system = DRAFT_SYSTEM, timeout = 90_000) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ timeout, maxRetries: 1 });
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    output_config: { effort: "high" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages,
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this draft.");
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function openaiText(model, messages, system = DRAFT_SYSTEM) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: system,
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      reasoning: { effort: "high" },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `OpenAI returned ${res.status}`);
  return data.output_text ?? (data.output || []).flatMap((o) => o.content || []).filter((p) => p.type === "output_text").map((p) => p.text).join("");
}

async function writeWith(messages, system = DRAFT_SYSTEM) {
  if (AI_PROVIDER === "openai") return openaiText(MODEL, messages, system);
  try {
    return await claudeText(MODEL, messages, system);
  } catch (error) {
    // An account without access to the top model still gets drafts from Opus.
    // No access to the top model, or it is too slow right now: Opus writes the draft instead.
    const slow = /timed out|timeout/i.test(String(error?.name) + String(error?.message));
    if (MODEL === "claude-fable-5-2" && (error.status === 404 || error.status === 403 || slow)) return claudeText("claude-opus-5-5", messages, system, 120_000);
    throw error;
  }
}

async function aiDraft(c, s, instruction = "") {
  const facts = {
    sender: {
      name: s.founder_name || "[your name]",
      title: s.founder_title,
      company: s.company,
      what_we_do: s.pitch,
      proof_points: s.proof || "(none supplied)",
      link: s.link,
    },
    recipient: {
      type: c.kind,
      organisation: c.org,
      name: c.name || "(unknown)",
      role: c.role || "(unknown)",
      why_they_fit: c.fit || "(not recorded)",
      warm_path: c.warm_path || "(none, this is a cold message)",
      why_now: c.why_now || "(nothing recent found)",
      notes: c.notes || "(none)",
    },
    the_ask: askFor(s, c.kind),
  };
  if (s.booking_link && rate(c).level === 1) facts.booking_link = s.booking_link;
  if (s.voice_samples.trim()) facts.how_the_sender_writes = s.voice_samples.trim().slice(0, 4000);
  const winners = db.prepare("SELECT subject, opener FROM sends WHERE replied = 1 AND followup_n = 0 ORDER BY at DESC LIMIT 5").all();
  if (winners.length >= 3) facts.first_emails_that_got_replies = winners;
  let ask = `Write the outreach for this recipient.\n\n${JSON.stringify(facts, null, 2)}`;
  if (instruction && c.email_body) {
    ask += `\n\nThe current draft is below. Rewrite it: ${instruction}\n\n${JSON.stringify({ email_subject: c.email_subject, email_body: c.email_body, li_note: c.li_note, li_message: c.li_message }, null, 2)}`;
  }
  const messages = [{ role: "user", content: ask }];
  const first = await writeWith(messages);
  let draft = parseDraft(first);
  const found = slopIn(draft);
  if (found.length) {
    // One rewrite pass that names exactly what sounded machine-written.
    const second = await writeWith([
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: `This reads as templated because it contains: ${found.join(", ")}. Rewrite all four fields without those, keeping every other rule. Return only the JSON object.` },
    ]);
    try { draft = parseDraft(second); } catch { /* keep the first draft if the rewrite came back malformed */ }
  }
  return draft;
}

const FOLLOWUP_SYSTEM = [
  "You write a follow-up to a first-touch email that got no reply, as the same founder, in the same voice: short, specific, clearly typed by a person.",
  "- Shorter than the first email: 30 to 70 words including greeting and sign-off.",
  "- Open with one light line that brings the first email back up without guilt. Vary it. Never: just following up, just checking in, bumping this, circling back, any chance you saw.",
  "- Then exactly ONE new thing the first email did not say. Good new things: a concrete picture of what one roundtable would look like for their firm, members or event; a specific idea tied to why they fit; the proof point, if one is supplied and was not used. Never repeat the pitch and never invent facts.",
  "- Then the ask again, made even smaller, alone on its own line as a question.",
  "- Sign off with the sender's first name only.",
  "- If this is the last follow-up, end gracefully: make it easy to say not now, and leave the door open.",
  "- No em dashes, no exclamation marks, no buzzwords.",
  "Return only a JSON object with the string key followup_body.",
].join("\n");

async function followupFor(c, n) {
  const s = getSettings();
  const subject = c.email_subject ? (/^re:/i.test(c.email_subject) ? c.email_subject : `Re: ${c.email_subject}`) : "";
  if (!aiEnabled) {
    const first = (c.name || "").split(" ")[0] || "there";
    const body = n >= MAX_FOLLOWUPS
      ? `Hi ${first}, last note from me on this. If now isn't the right time, no problem at all, and I'm happy to pick it up later.\n\n${askFor(s, c.kind)} Still open to it?\n\n${s.founder_name || "[your name]"}`
      : `Hi ${first}, bringing this back up in case it got buried.\n\n${askFor(s, c.kind)} Would that work?\n\n${s.founder_name || "[your name]"}`;
    return { followup_subject: subject, followup_body: body, source: "template" };
  }
  const facts = {
    sender: { name: s.founder_name || "[your name]", company: s.company, what_we_do: s.pitch, proof_points: s.proof || "(none supplied)", link: s.link },
    recipient: { type: c.kind, organisation: c.org, name: c.name || "(unknown)", role: c.role || "(unknown)", why_they_fit: c.fit || "(not recorded)", notes: c.notes || "(none)" },
    the_ask: askFor(s, c.kind),
    first_email: { subject: c.email_subject, body: c.email_body },
    this_followup: `${n} of ${MAX_FOLLOWUPS}${n >= MAX_FOLLOWUPS ? " (the last one)" : ""}`,
  };
  const messages = [{ role: "user", content: `Write the follow-up.\n\n${JSON.stringify(facts, null, 2)}` }];
  const write = (msgs) => (AI_PROVIDER === "openai" ? openaiText(MODEL, msgs, FOLLOWUP_SYSTEM) : writeWith(msgs, FOLLOWUP_SYSTEM));
  const first = await write(messages);
  const parse = (text) => {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    const body = start >= 0 ? JSON.parse(text.slice(start, end + 1)).followup_body : "";
    if (typeof body !== "string" || !body.trim()) throw new Error("The model did not return a follow-up.");
    return body.trim();
  };
  let body = parse(first);
  const found = [...slopIn({ body }), ...(/just (following up|checking in)|bumping/i.test(body) ? ["just following up"] : [])];
  if (found.length) {
    try {
      body = parse(await write([...messages, { role: "assistant", content: first },
        { role: "user", content: `This reads as templated because it contains: ${found.join(", ")}. Rewrite without those. Return only the JSON object.` }]));
    } catch { /* keep the first version */ }
  }
  return { followup_subject: subject, followup_body: body, source: "ai" };
}

// ---------- block list ----------

const blockTerms = () => getSettings().block_list.split(/[\n,]/).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 2);
function isBlocked(x) {
  const terms = blockTerms();
  if (!terms.length) return false;
  const hay = [x.org, x.name, x.email, rootDomain(x.website), String(x.email || "").split("@")[1]].map((v) => String(v || "").toLowerCase());
  return terms.some((t) => hay.some((h) => h && (h === t || (t.length > 4 && h.includes(t)))));
}

// ---------- why-now research ----------

const RESEARCH_MODEL = "claude-opus-5-5";
const RESEARCH_SYSTEM = [
  "You research one person or organisation for a founder who is about to write to them.",
  "Search the web for something recent (ideally the last six months) that gives a natural, specific reason to write now: a new fund or investment, a deal in a related space, a talk, an event they run, a programme or call for speakers, a post or article they wrote, a launch, a hire, a milestone.",
  "Only use what you actually found. If nothing recent and relevant turns up, say so by returning an empty why_now. Never guess or generalise.",
  "Return only a JSON object: {\"why_now\": at most two short plain sentences naming the specific thing and roughly when it happened, \"sources\": [{\"title\": string, \"url\": string}] with one to three of the pages you used}.",
].join("\n");

async function researchWhyNow(x) {
  if (AI_PROVIDER !== "anthropic") throw new Error("Research needs an Anthropic key.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ timeout: 180_000, maxRetries: 1 });
  const subject = {
    type: x.kind, organisation: x.org, person: x.name || "(no person yet)", role: x.role || "", website: x.website || "",
    linkedin: x.linkedin || "", what_we_know: x.fit || "", sender_company: getSettings().company, sender_pitch: getSettings().pitch,
  };
  let messages = [{ role: "user", content: `Find a reason to write now.\n\n${JSON.stringify(subject, null, 2)}` }];
  let response;
  const seen = new Map();
  for (let turn = 0; turn < 4; turn++) {
    response = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      system: RESEARCH_SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages,
    });
    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) seen.set(r.url, r.title || r.url);
      }
    }
    if (response.stop_reason !== "pause_turn") break;
    messages = [...messages, { role: "assistant", content: response.content }];
  }
  if (response.stop_reason === "refusal") throw new Error("The model declined this research.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0) return { why_now: "", sources: [] };
  const parsed = JSON.parse(text.slice(start, end + 1));
  // Keep only links the search actually returned, so no source is made up.
  const sources = (Array.isArray(parsed.sources) ? parsed.sources : [])
    .filter((src) => src && seen.has(src.url)).slice(0, 3).map((src) => ({ title: tidy(src.title || seen.get(src.url), 120), url: src.url }));
  // Keep whole sentences: at most two, and never cut a word in half.
  const full = tidy(parsed.why_now, 2000);
  const sentences = full.match(/[^.!?]+[.!?]+(\s|$)/g) || [full];
  let whyNow = sentences.slice(0, 2).join("").trim();
  if (whyNow.length > 420) whyNow = sentences[0].trim();
  return { why_now: sources.length ? whyNow : "", sources };
}

async function researchContact(c) {
  const r = await researchWhyNow(c);
  db.prepare("UPDATE contacts SET why_now = ?, why_now_sources = ?, researched_at = ?, updated_at = ? WHERE id = ?")
    .run(r.why_now, JSON.stringify(r.sources), now(), now(), c.id);
  return r;
}

const today = () => new Date().toISOString().slice(0, 10);
const researchedToday = () =>
  db.prepare("SELECT (SELECT count(*) FROM contacts WHERE researched_at >= ?) + (SELECT count(*) FROM leads WHERE researched_at >= ?) AS n").get(today(), today()).n;
const researchCap = () => Math.max(0, Number(getSettings().daily_research_cap) || 0);
db.exec("CREATE TABLE IF NOT EXISTS auto_log (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, what TEXT, at TEXT NOT NULL)");
const autoToday = () => db.prepare("SELECT count(*) AS n FROM auto_log WHERE at >= ?").get(today()).n;
const logAuto = (id, what) => db.prepare("INSERT INTO auto_log (contact_id, what, at) VALUES (?, ?, ?)").run(id, what, now());

// ---------- autopilot ----------

// The moment a strong or dream lead enters the pipeline: research why now, find the email for dream leads,
// and write the first draft into the review queue. Weaker leads are left alone, so nothing is spent on them.
const autopilot = {
  queue: [],
  running: false,
  enqueue(id) {
    if (!this.queue.includes(id)) this.queue.push(id);
    this.run();
  },
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift();
        try { await this.work(id); } catch (error) { console.log(`autopilot: contact ${id}: ${error.message}`); }
      }
    } finally { this.running = false; }
  },
  async work(id) {
    let c = getContact(id);
    if (!c || isBlocked(c) || !["Research", "Ready"].includes(c.stage) || c.review === "dismissed") return;
    if (rate(c).level > 2) return;
    // The daily cap covers everything done automatically, so a big search cannot drain credit overnight.
    if (autoToday() >= researchCap()) return;
    logAuto(id, "pipeline");
    if (!c.researched_at && AI_PROVIDER === "anthropic" && researchedToday() < researchCap()) {
      await researchContact(c);
      c = getContact(id);
    }
    if (rate(c).level === 1 && !c.email && leadsEnabled && (c.linkedin || c.name)) {
      try {
        const { email } = await findEmail(c);
        if (email) { updateContact(id, { email }); db.prepare("UPDATE contacts SET email_available = 1 WHERE id = ?").run(id); }
      } catch { /* drafting still goes ahead without an email */ }
      c = getContact(id);
    }
    if (!c.email_body && aiEnabled) {
      const { draft, source } = await draftFor(c);
      if (source === "ai") { updateContact(id, draft); db.prepare("UPDATE contacts SET review = 'pending' WHERE id = ?").run(id); }
    }
  },
};

async function draftFor(contact, instruction = "") {
  const settings = getSettings();
  if (!aiEnabled) return { draft: templateDraft(contact, settings), source: "template" };
  try {
    return { draft: await aiDraft(contact, settings, instruction), source: "ai" };
  } catch (error) {
    return { draft: templateDraft(contact, settings), source: "template", warning: `AI draft failed (${error.message}). Used the template instead.` };
  }
}

// ---------- login ----------

const SESSION_DAYS = 30;
const sessionSecret = createHash("sha256").update(`bridge-outreach-session:${APP_PASSWORD}`).digest();
const sign = (value) => createHmac("sha256", sessionSecret).update(value).digest("base64url");
const sameText = (a, b) => {
  const x = createHash("sha256").update(String(a)).digest();
  const y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
};

function newSessionCookie() {
  const expires = String(Date.now() + SESSION_DAYS * 86_400_000);
  return `session=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${HOSTED ? "; Secure" : ""}`;
}

function signedIn(req) {
  if (!authRequired) return true;
  if (!APP_PASSWORD) return false;
  const cookie = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("session="));
  if (!cookie) return false;
  const [expires, signature] = cookie.slice("session=".length).split(".");
  return Boolean(expires && signature) && Number(expires) > Date.now() && sameText(signature, sign(expires));
}

// Ten wrong passwords from one address locks that address out for fifteen minutes.
const loginAttempts = new Map();
function tooManyAttempts(req) {
  const who = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const entry = loginAttempts.get(who);
  if (entry && entry.until > Date.now()) return { who, blocked: entry.count >= 10 };
  loginAttempts.set(who, { count: 0, until: Date.now() + 15 * 60_000 });
  return { who, blocked: false };
}

function loginPage(message = "") {
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const body = APP_PASSWORD
    ? `<form method="post" action="/login">
         <label for="password">Password</label>
         <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
         ${message ? `<p class="error">${esc(message)}</p>` : ""}
         <button type="submit">Sign in</button>
       </form>`
    : `<p>This app is locked. Set an <code>APP_PASSWORD</code> environment variable for the service, then reload.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Bridge Outreach</title><style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f5f1; color: #1c1b18; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
  main { width: min(360px, calc(100vw - 32px)); background: #fff; border: 1px solid #e4e1d8; border-radius: 12px; padding: 26px; }
  h1 { font-size: 20px; margin: 0 0 4px; } .sub { color: #6f6b62; margin: 0 0 18px; font-size: 14px; }
  label { display: block; font-size: 13px; color: #6f6b62; margin-bottom: 4px; }
  input { width: 100%; box-sizing: border-box; font: inherit; padding: 11px 12px; border: 1px solid #e4e1d8; border-radius: 8px; }
  input:focus, button:focus-visible { outline: 2px solid #2f5d50; outline-offset: 1px; }
  button { width: 100%; margin-top: 14px; min-height: 46px; font: inherit; font-weight: 600; color: #fff; background: #2f5d50; border: 0; border-radius: 8px; cursor: pointer; }
  .error { color: #a23b2e; font-size: 14px; margin: 8px 0 0; } code { font-size: 13px; }
</style></head><body><main><h1>Bridge Outreach</h1><p class="sub">Investors, partners, conferences, communities</p>${body}</main></body></html>`;
}

async function loginRoutes(req, res, url) {
  if (url.pathname === "/logout") {
    res.writeHead(302, { Location: "/login", "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
    return res.end();
  }
  if (req.method === "POST" && APP_PASSWORD) {
    const attempt = tooManyAttempts(req);
    if (attempt.blocked) return send(res, 429, loginPage("Too many attempts. Try again in fifteen minutes."), "text/html; charset=utf-8");
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) break; }
    if (sameText(new URLSearchParams(raw).get("password") || "", APP_PASSWORD)) {
      loginAttempts.delete(attempt.who);
      res.writeHead(302, { Location: "/", "Set-Cookie": newSessionCookie() });
      return res.end();
    }
    loginAttempts.get(attempt.who).count++;
    return send(res, 401, loginPage("That password is not right."), "text/html; charset=utf-8");
  }
  if (signedIn(req)) { res.writeHead(302, { Location: "/" }); return res.end(); }
  return send(res, 200, loginPage(), "text/html; charset=utf-8");
}

// ---------- http ----------

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) { reject(new Error("Request too large.")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("Invalid JSON.")); }
    });
    req.on("error", reject);
  });
}

function state() {
  return {
    contacts: db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all().map((c) => ({ ...c, rating: rate(c) })),
    activity: db.prepare("SELECT * FROM activity ORDER BY at DESC LIMIT 500").all(),
    settings: getSettings(),
    ai: aiEnabled,
    aiModel: aiEnabled ? MODEL : "",
    auth: authRequired,
    leads: { enabled: leadsEnabled, pricePerFirm: PRICE_PER_FIRM, pricePerLookup: PRICE_PER_LOOKUP },
    leadResults: leadResults(),
    allLeads: db.prepare("SELECT * FROM leads ORDER BY seen_at DESC, id DESC LIMIT 5000").all().map((l) => ({ ...l, rating: rate(l) })),
    research: { today: researchedToday(), cap: researchCap(), enabled: AI_PROVIDER === "anthropic" },
    insights: insights(),
    gmail: { configured: gmailConfigured, connected: gmailConnected(), address: getSecret("gmail_address"), redirect: GOOGLE_REDIRECT },
    kinds: KINDS,
    stages: STAGES,
  };
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  if (method === "GET" && parts[1] === "state") return send(res, 200, state());
  if (method === "GET" && parts[1] === "export.csv") {
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="outreach.csv"' });
    return res.end(exportCsv());
  }
  if (method === "PUT" && parts[1] === "settings") {
    const body = await readJson(req);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof body[key] === "string") {
        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(key, body[key].trim());
      }
    }
    return send(res, 200, state());
  }
  if (method === "POST" && parts[1] === "import") {
    const body = await readJson(req);
    const result = importCsv(String(body.csv || ""), KINDS.includes(body.kind) ? body.kind : "investor");
    return send(res, result.error ? 400 : 200, { ...result, ...state() });
  }
  if (parts[1] === "leads") return leadRoutes(req, res, parts);
  if (method === "POST" && parts[1] === "gmail" && parts[2] === "sync") {
    const body = await readJson(req);
    // Background checks from the page are throttled; a button press always runs.
    if (body.auto && Date.now() - lastSync < 120_000) return send(res, 200, { found: { sent: 0, replies: 0 }, ...state() });
    const found = await syncGmail();
    return send(res, 200, { found, ...state() });
  }
  if (method === "POST" && parts[1] === "gmail" && parts[2] === "disconnect") {
    const token = getSecret("gmail_refresh_token");
    if (token) {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }).catch(() => {});
    }
    clearGmail();
    return send(res, 200, state());
  }
  if (parts[1] === "contacts") {
    if (method === "POST" && parts.length === 2) {
      const body = await readJson(req);
      if (!String(body.org || "").trim() && !String(body.name || "").trim()) {
        return send(res, 400, { error: "Add at least an organisation or a name." });
      }
      const contact = insertContact(body);
      autopilot.enqueue(contact.id);
      return send(res, 200, { contact, ...state() });
    }
    const id = Number(parts[2]);
    const contact = getContact(id);
    if (!contact) return send(res, 404, { error: "Contact not found." });

    if (method === "PUT" && parts.length === 3) {
      const body = await readJson(req);
      updateContact(id, body);
      for (const key of ["followup_subject", "followup_body"]) {
        if (typeof body[key] === "string") db.prepare(`UPDATE contacts SET ${key} = ? WHERE id = ?`).run(body[key].slice(0, 5000), id);
      }
      return send(res, 200, state());
    }
    if (method === "DELETE" && parts.length === 3) {
      db.prepare("DELETE FROM activity WHERE contact_id = ?").run(id);
      db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
      return send(res, 200, state());
    }
    if (method === "POST" && parts[3] === "draft") {
      const body = await readJson(req);
      const instruction = { warmer: "make it warmer and more personal, same length.", shorter: "make every field noticeably shorter.", plainer: "make it plainer and more direct, like a quick note between peers." }[body.style] || "";
      if (isBlocked(contact)) return send(res, 400, { error: "This contact is on your block list. Remove them from it on the Your pitch page to write to them." });
      const { draft, source, warning } = await draftFor(contact, instruction);
      if (["Research", "Ready"].includes(contact.stage)) db.prepare("UPDATE contacts SET review = 'pending' WHERE id = ?").run(id);
      updateContact(id, draft);
      return send(res, 200, { source, warning, ...state() });
    }
    if (method === "POST" && parts[3] === "dream") {
      const body = await readJson(req);
      db.prepare("UPDATE contacts SET dream = ?, updated_at = ? WHERE id = ?").run(body.dream ? 1 : 0, now(), id);
      if (body.dream) autopilot.enqueue(id);
      return send(res, 200, state());
    }
    if (method === "POST" && parts[3] === "research") {
      try { await researchContact(contact); }
      catch (error) { return send(res, 400, { error: `Research failed (${error.message}).`, ...state() }); }
      return send(res, 200, state());
    }
    if (method === "POST" && parts[3] === "review") {
      const body = await readJson(req);
      if (body.action === "snooze") {
        const days = [1, 3, 7, 14, 30].includes(Number(body.days)) ? Number(body.days) : 7;
        db.prepare("UPDATE contacts SET review = 'snoozed', snooze_until = ?, updated_at = ? WHERE id = ?")
          .run(new Date(Date.now() + days * 86_400_000).toISOString(), now(), id);
      } else if (body.action === "dismiss") {
        db.prepare("UPDATE contacts SET review = 'dismissed', stage = 'Passed', updated_at = ? WHERE id = ?").run(now(), id);
        logEvent(getContact(id), "note", "Dismissed from the review queue");
      } else if (body.action === "pending") {
        db.prepare("UPDATE contacts SET review = 'pending', updated_at = ? WHERE id = ?").run(now(), id);
      }
      return send(res, 200, state());
    }
    if (method === "POST" && parts[3] === "send") {
      // Approve and send through Gmail: the first email, or the next follow-up in the same thread.
      const body = await readJson(req);
      const followup = body.which === "followup";
      if (!gmailConnected()) return send(res, 400, { error: "Connect Gmail on the Your pitch page to send from here." });
      if (isBlocked(contact)) return send(res, 400, { error: "This contact is on your block list." });
      try {
        const n = followupsSent(id) + 1;
        if (followup) db.prepare("UPDATE contacts SET followup_subject = ?, followup_body = ? WHERE id = ?").run(String(body.subject || ""), String(body.body || ""), id);
        else updateContact(id, { email_subject: body.subject, email_body: body.body });
        const fresh = getContact(id);
        await sendGmail(fresh, { subject: body.subject, body: body.body, followup });
        logEvent(fresh, "email", followup ? `Follow-up ${n} sent (Gmail)` : "Email sent (Gmail)");
        db.prepare("UPDATE contacts SET review = 'approved' WHERE id = ?").run(id);
        if (followup) db.prepare("UPDATE contacts SET followup_subject = '', followup_body = '' WHERE id = ?").run(id);
        return send(res, 200, state());
      } catch (error) {
        return send(res, 400, { error: error.message, ...state() });
      }
    }
    if (method === "POST" && parts[3] === "followup") {
      if (!contact.email_body) return send(res, 400, { error: "Write and send the first email before a follow-up." });
      const n = followupsSent(id) + 1;
      if (n > MAX_FOLLOWUPS) return send(res, 400, { error: `You have sent ${MAX_FOLLOWUPS} follow-ups. More than that rarely helps; mark them as passed or wait for a reply.` });
      try {
        const f = await followupFor(contact, n);
        db.prepare("UPDATE contacts SET followup_subject = ?, followup_body = ?, review = 'pending', updated_at = ? WHERE id = ?").run(f.followup_subject, f.followup_body, now(), id);
        return send(res, 200, { source: f.source, ...state() });
      } catch (error) {
        return send(res, 400, { error: `Follow-up failed (${error.message}).`, ...state() });
      }
    }
    if (method === "POST" && parts[3] === "sent") {
      const body = await readJson(req);
      const channel = ["email", "linkedin_note", "linkedin_message", "reply", "meeting", "note"].includes(body.channel)
        ? body.channel : "note";
      logEvent(contact, channel, String(body.summary || "").slice(0, 500));
      // A sent follow-up is used up; the next one is written fresh.
      if (/^Follow-up/.test(String(body.summary || ""))) db.prepare("UPDATE contacts SET followup_subject = '', followup_body = '' WHERE id = ?").run(id);
      return send(res, 200, state());
    }
    if (method === "POST" && parts[3] === "find-email") {
      if (!leadsEnabled) return send(res, 400, { error: "Lead finding is not set up on this machine." });
      if (!contact.linkedin && !(contact.name && (contact.website || contact.org))) {
        return send(res, 400, { error: "Add their LinkedIn profile, or their name and organisation, first." });
      }
      const { email, charge } = await findEmail(contact);
      if (email) {
        updateContact(id, { email });
        logEvent(getContact(id), "note", "Email found");
      }
      return send(res, 200, { found: Boolean(email), charge, ...state() });
    }
    if (method === "POST" && parts[3] === "gmail-draft") {
      const body = await readJson(req);
      const saved = updateContact(id, { email_subject: body.email_subject, email_body: body.email_body });
      try {
        await createGmailDraft(saved);
      } catch (error) {
        return send(res, 400, { error: error.message, ...state() });
      }
      return send(res, 200, state());
    }
  }
  return send(res, 404, { error: "Not found." });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/healthz") return send(res, 200, "ok", "text/plain");
    if (url.pathname === "/login" || url.pathname === "/logout") return await loginRoutes(req, res, url);
    if (!signedIn(req)) {
      if (url.pathname.startsWith("/api/")) return send(res, 401, { error: "Sign in again." });
      res.writeHead(302, { Location: "/login" });
      return res.end();
    }
    // Changes must come from this site's own pages, not from another site using the visitor's session.
    const origin = req.headers.origin;
    if (req.method !== "GET" && origin && new URL(origin).host !== req.headers.host) {
      return send(res, 403, { error: "Request refused." });
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname.startsWith("/auth/")) return await authRoutes(req, res, url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(res, 200, fs.readFileSync(path.join(here, "public", "index.html")), "text/html; charset=utf-8");
    }
    return send(res, 404, { error: "Not found." });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

// ---------- what works ----------

function insights() {
  const sends = db.prepare("SELECT * FROM sends").all();
  const firsts = sends.filter((x) => x.followup_n === 0);
  const group = (rows, key, label) => {
    const out = {};
    for (const r of rows) {
      const k = label(r[key], r);
      out[k] = out[k] || { sent: 0, replied: 0 };
      out[k].sent++; if (r.replied) out[k].replied++;
    }
    return Object.entries(out).map(([name, v]) => ({ name, ...v, rate: v.sent ? v.replied / v.sent : 0 })).sort((a, b) => b.sent - a.sent);
  };
  const people = db.prepare("SELECT count(DISTINCT contact_id) AS n FROM sends").get().n;
  const repliedPeople = db.prepare("SELECT count(DISTINCT contact_id) AS n FROM sends WHERE replied = 1").get().n;
  return {
    sent: sends.length,
    people,
    repliedPeople,
    byKind: group(firsts, "kind", (v) => v || "unknown"),
    byLevel: group(firsts, "level", (v) => LEVELS[v] || "unknown"),
    byWarm: group(firsts, "warm", (v) => (v ? "Warm intro" : "Cold")),
    byWhyNow: group(firsts, "why_now", (v) => (v ? "With a why-now reason" : "Without one")),
    byMessage: group(sends, "followup_n", (v) => (v ? `Follow-up ${v}` : "First email")),
    replied: db.prepare("SELECT s.subject, s.opener, s.followup_n, s.kind, c.org, c.name FROM sends s JOIN contacts c ON c.id = s.contact_id WHERE s.replied = 1 ORDER BY s.at DESC LIMIT 10").all(),
  };
}

// ---------- background work ----------

// Every ten minutes: check Gmail for sends and replies, draft follow-ups that are due into the review
// queue, and pick up strong leads the autopilot has not handled yet. Everything stays inside the daily cap.
async function tick() {
  try { if (gmailConnected()) await syncGmail(); } catch (error) { console.log(`gmail sync: ${error.message}`); }
  if (!aiEnabled) return;
  const days = Number(getSettings().followup_days) || 5;
  const due = db.prepare("SELECT * FROM contacts WHERE stage = 'Contacted' AND followup_body = '' AND email_body != '' AND last_contacted IS NOT NULL").all();
  for (const c of due) {
    if (autoToday() >= researchCap()) break;
    if ((Date.now() - new Date(c.last_contacted).getTime()) / 86_400_000 < days) continue;
    if (c.review === "dismissed" || (c.review === "snoozed" && c.snooze_until > now())) continue;
    if (isBlocked(c)) continue;
    const n = followupsSent(c.id) + 1;
    if (n > MAX_FOLLOWUPS) continue;
    try {
      logAuto(c.id, "followup");
      const f = await followupFor(c, n);
      db.prepare("UPDATE contacts SET followup_subject = ?, followup_body = ?, review = 'pending', updated_at = ? WHERE id = ?").run(f.followup_subject, f.followup_body, now(), c.id);
    } catch (error) { console.log(`follow-up for ${c.id}: ${error.message}`); }
  }
  for (const c of db.prepare("SELECT * FROM contacts WHERE stage IN ('Research', 'Ready') AND email_body = '' AND review != 'dismissed'").all()) {
    if (rate(c).level <= 2) autopilot.enqueue(c.id);
  }
}
setInterval(tick, 10 * 60_000).unref();
setTimeout(tick, 5_000).unref();

server.listen(PORT, HOSTED ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(
    `Bridge Outreach running at ${PUBLIC_URL} (drafts: ${aiEnabled ? "AI" : "templates"}; lead finding: ${leadsEnabled ? "on" : "off"}; login: ${
      !authRequired ? "off" : APP_PASSWORD ? "on" : "locked until APP_PASSWORD is set"
    })`,
  );
});
