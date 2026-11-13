// Talks to server.mjs and holds the helpers every page shares.
import { createContext, useContext } from "react";

export async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Sign in again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.state = data.contacts ? data : null;
    throw error;
  }
  return data;
}

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export const KIND_LABEL = { investor: "Investors", partner: "Partners", conference: "Conferences", community: "Communities" };
export const KIND_COLOR = { investor: "blue", partner: "purple", conference: "orange", community: "teal" };
export const STAGE_COLOR = { Research: "gray", Ready: "blue", Contacted: "yellow", Replied: "green", Meeting: "green", Passed: "gray" };
export const LEVEL_COLOR = { 1: "yellow", 2: "orange", 3: "blue", 4: "gray" };

export const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
export const title = (c) => c.org || c.name || "Untitled";
export const person = (c) => [c.org ? c.name : "", c.role].filter(Boolean).join(", ");
export const sources = (x) => {
  try { return JSON.parse(x.why_now_sources || "[]"); } catch { return []; }
};
export const safeUrl = (raw) => {
  if (!raw) return "";
  const v = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) ? u.href : ""; } catch { return ""; }
};
export const linkedinSearch = (c) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([c.name, c.org].filter(Boolean).join(" ") || c.org || "")}`;
export const gmailCompose = (to, subject, body) =>
  `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to || "")}&su=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(body || "")}`;

export const inPipeline = (S, r) =>
  S.contacts.some((c) => (c.org || "").toLowerCase() === (r.org || "").toLowerCase() && (c.name || "").toLowerCase() === (r.name || "").toLowerCase());

export const followupsSentCount = (S, id) => S.activity.filter((a) => a.contact_id === id && /^Follow-up/.test(a.summary)).length;

export const followups = (S) => {
  const limit = Number(S.settings.followup_days) || 5;
  return S.contacts.filter((c) => c.stage === "Contacted" && daysSince(c.last_contacted) !== null && daysSince(c.last_contacted) >= limit);
};

// Drafts waiting for a yes: first emails not sent yet, and follow-ups that are due.
export const reviewQueue = (S) => {
  const now = new Date().toISOString();
  return S.contacts
    .filter((c) => (c.review === "pending" || (c.review === "snoozed" && c.snooze_until && c.snooze_until <= now)) &&
      ((["Research", "Ready"].includes(c.stage) && c.email_body) || (c.stage === "Contacted" && c.followup_body)))
    .sort((a, b) => (a.rating?.level || 4) - (b.rating?.level || 4) || (b.rating?.score || 0) - (a.rating?.score || 0));
};

// The few other things worth doing now: replies, due follow-ups, LinkedIn as a second channel,
// the best people not yet written to, and hot leads not yet in the pipeline.
export function todayActions(S) {
  const acts = [];
  for (const c of S.contacts.filter((x) => x.stage === "Replied")) {
    acts.push({ rank: 0, id: c.id, text: `${c.name || title(c)} replied`, sub: `${title(c)} · ${c.kind}`, button: "Open" });
  }
  for (const c of followups(S).filter((x) => !x.followup_body)) {
    acts.push({ rank: 1, id: c.id, text: `Follow up with ${c.name || title(c)}, ${daysSince(c.last_contacted)} days since you wrote`, sub: `${title(c)} · ${c.kind}`, button: "Open" });
  }
  for (const c of S.contacts.filter((x) => x.stage === "Contacted" && x.li_note && daysSince(x.last_contacted) >= 7)) {
    if (S.activity.some((a) => a.contact_id === c.id && a.channel === "linkedin_note")) continue;
    acts.push({ rank: 1.5, id: c.id, text: `Send ${c.name || title(c)} a LinkedIn connection note`, sub: `${title(c)} · no reply to your email after ${daysSince(c.last_contacted)} days`, button: "Open" });
  }
  S.contacts
    .filter((c) => ["Research", "Ready"].includes(c.stage) && !c.email_body && c.review !== "dismissed")
    .sort((a, b) => (b.rating?.score || 0) - (a.rating?.score || 0))
    .slice(0, 4)
    .forEach((c) => acts.push({ rank: 2, id: c.id, text: `Write to ${c.name || title(c)}`, sub: `${title(c)} · ${c.kind} · score ${c.rating?.score} ${c.rating?.tier}`, button: "Write" }));
  const hot = (S.allLeads || []).filter((l) => !inPipeline(S, l) && l.rating?.tier === "Hot");
  if (hot.length) acts.push({ rank: 3, view: "leads", text: `${hot.length} hot lead${hot.length === 1 ? "" : "s"} not in your pipeline yet`, sub: "From your searches", button: "Review" });
  return acts.sort((a, b) => a.rank - b.rank).slice(0, 8);
}

export async function copyText(text, toast, label) {
  try { await navigator.clipboard.writeText(text); toast?.({ body: label }); }
  catch { toast?.({ body: "Could not copy. Select the text and copy it by hand.", type: "error" }); }
}
