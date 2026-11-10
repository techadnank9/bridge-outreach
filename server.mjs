// Bridge Outreach: a small local app for tracking investors, partners and
// conferences, and drafting the email and LinkedIn message for each one.
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
// One shared password protects the whole app. Hosted without one, the app stays locked.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const authRequired = HOSTED || Boolean(APP_PASSWORD);
const MODEL = process.env.DRAFT_MODEL || "claude-opus-5-5";
const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

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

const KINDS = ["investor", "partner", "conference"];
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
`);
if (!db.prepare("PRAGMA table_info(contacts)").all().some((col) => col.name === "gmail_draft_at")) {
  db.exec("ALTER TABLE contacts ADD COLUMN gmail_draft_at TEXT");
}

const DEFAULT_SETTINGS = {
  founder_name: "",
  founder_title: "Founder",
  company: "thebridge",
  pitch:
    "thebridge is an AI R&D lab studying how groups think together. Our product, roundtable, brings up to six people together for a focused conversation. Nova, our AI co-host, helps find the right people, supports the room when invited, and turns what mattered into next steps.",
  investor_ask: "A 20 minute conversation, or a seat at a small roundtable we are hosting on how AI changes group decisions.",
  partner_ask: "A short call to explore running a pilot roundtable with your team or community.",
  conference_ask: "A speaking slot or a hosted roundtable session at your event.",
  proof: "",
  link: "https://thebridge.ai",
  followup_days: "5",
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

// Partners and conferences: people with a given role at organisations described by keywords.
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
  if (parts[2] === "investors") {
    const query = tidy(body.query, 300);
    if (query.length < 8) return send(res, 400, { error: "Describe what your company does in a few words." });
    const count = [5, 10, 20].includes(Number(body.count)) ? Number(body.count) : 5;
    return send(res, 200, await findInvestors({ query, count, earlyOnly: body.earlyOnly !== false }));
  }
  if (parts[2] === "people") {
    const keywords = splitList(body.keywords, 8);
    const titles = splitList(body.titles, 8);
    if (!keywords.length || !titles.length) return send(res, 400, { error: "Add at least one keyword and one role." });
    return send(res, 200, await findPeople({ kind: body.kind === "conference" ? "conference" : "partner", keywords, titles }));
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
      insertContact({
        kind: row.kind, org, name, role: row.role, linkedin: row.linkedin, website: row.website, fit: row.fit,
        stage: "Research",
      });
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
    insertContact(record);
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
  kind === "partner" ? s.partner_ask : kind === "conference" ? s.conference_ask : s.investor_ask;

function templateDraft(c, s) {
  const first = (c.name || "").split(" ")[0] || "there";
  const me = s.founder_name || "[your name]";
  const fit = c.fit ? c.fit.replace(/\.$/, "") : "";
  const opener =
    c.warm_path ? `${c.warm_path.replace(/\.$/, "")} suggested I reach out.`
    : fit ? `Why I'm writing to you in particular: ${fit}.`
    : c.kind === "conference" ? `I've been following ${c.org || "your event"} and would like to contribute.`
    : `I've been following ${c.org || "your work"} and think there is a fit.`;
  const ask = askFor(s, c.kind);
  const subject =
    c.kind === "investor" ? `${s.company}: how groups think together with AI`
    : c.kind === "partner" ? `${s.company} x ${c.org || "you"}: a pilot roundtable`
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

async function aiDraft(c, s) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const system = [
    "You write first-touch outreach for a startup founder. You write as the founder, in first person.",
    "The reader is a busy investor, partner or conference organiser who gets many such messages, so each one must be short, specific to them, and end in one concrete ask.",
    "Use only the facts supplied. Never invent traction, numbers, mutual connections, or details about the recipient. If a fact is missing, write around it.",
    "Plain, warm, direct English. No hype words, no flattery, no exclamation marks, no em dashes.",
    "If a warm path is given, lead with it. Otherwise lead with the reason this person is a fit.",
    "Return only a JSON object with these string keys: email_subject (under 9 words), email_body (under 130 words, with greeting and sign-off), li_note (a LinkedIn connection note, at most 280 characters), li_message (a LinkedIn message for after they accept, under 80 words).",
  ].join("\n");
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
      notes: c.notes || "(none)",
    },
    the_ask: askFor(s, c.kind),
  };
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: `Write the outreach for this recipient.\n\n${JSON.stringify(facts, null, 2)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this draft.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
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

async function draftFor(contact) {
  const settings = getSettings();
  if (!aiEnabled) return { draft: templateDraft(contact, settings), source: "template" };
  try {
    return { draft: await aiDraft(contact, settings), source: "ai" };
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
</style></head><body><main><h1>Bridge Outreach</h1><p class="sub">Investors, partners, conferences</p>${body}</main></body></html>`;
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
    contacts: db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all(),
    activity: db.prepare("SELECT * FROM activity ORDER BY at DESC LIMIT 500").all(),
    settings: getSettings(),
    ai: aiEnabled,
    auth: authRequired,
    leads: { enabled: leadsEnabled, pricePerFirm: PRICE_PER_FIRM, pricePerLookup: PRICE_PER_LOOKUP },
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
      return send(res, 200, { contact, ...state() });
    }
    const id = Number(parts[2]);
    const contact = getContact(id);
    if (!contact) return send(res, 404, { error: "Contact not found." });

    if (method === "PUT" && parts.length === 3) {
      updateContact(id, await readJson(req));
      return send(res, 200, state());
    }
    if (method === "DELETE" && parts.length === 3) {
      db.prepare("DELETE FROM activity WHERE contact_id = ?").run(id);
      db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
      return send(res, 200, state());
    }
    if (method === "POST" && parts[3] === "draft") {
      const { draft, source, warning } = await draftFor(contact);
      updateContact(id, draft);
      return send(res, 200, { source, warning, ...state() });
    }
    if (method === "POST" && parts[3] === "sent") {
      const body = await readJson(req);
      const channel = ["email", "linkedin_note", "linkedin_message", "reply", "meeting", "note"].includes(body.channel)
        ? body.channel : "note";
      logEvent(contact, channel, String(body.summary || "").slice(0, 500));
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

server.listen(PORT, HOSTED ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(
    `Bridge Outreach running at ${PUBLIC_URL} (drafts: ${aiEnabled ? "AI" : "templates"}; lead finding: ${leadsEnabled ? "on" : "off"}; login: ${
      !authRequired ? "off" : APP_PASSWORD ? "on" : "locked until APP_PASSWORD is set"
    })`,
  );
});
