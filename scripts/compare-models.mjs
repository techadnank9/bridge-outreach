// Head-to-head test: the app's real outreach prompt, run on Claude and OpenAI models.
// Usage: ANTHROPIC_API_KEY=... OPENAI_API_KEY=... node scripts/compare-models.mjs
// Models whose key is missing are skipped. Writes scripts/compare-report.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));

// USD per million tokens (input, output), from the providers' pricing pages on 2026-11-12.
const MODELS = [
  { provider: "anthropic", id: "claude-fable-5-2", price: [8, 40] },
  { provider: "anthropic", id: "claude-opus-5-5", price: [4, 20] },
  
  { provider: "openai", id: "gpt-6-astra", price: [10, 50] },
  { provider: "openai", id: "gpt-6.1-terra", price: [1, 5] },
];

const SYSTEM = [
  "You write first-touch outreach as the founder, in first person, the way a busy founder actually writes to someone they respect: short, specific, a little informal, clearly typed by a person.",
  "The reader is an investor, partner or event organiser who deletes anything that smells like a template. The test of a good message: it could only have been sent to this one person, and replying takes them ten seconds.",
  "",
  "How to write it:",
  "- Open with the specific reason you are writing to them: the warm path if there is one, otherwise the concrete thing in why_they_fit. Never open with who you are, a pleasantry, or a compliment.",
  "- Then one or two plain sentences on what thebridge does, said the way you would say it out loud, tied to why it matters to them.",
  "- End with one small, specific ask phrased as a question. No menu of options.",
  "- Use contractions. Mix short and medium sentences. No lists, no bold, no headings, no buzzwords.",
  "- Sign off with the sender's first name only, on its own line, with no closing phrase like Best or Cheers before it.",
  "- Use only the facts supplied. Never invent traction, numbers, mutual connections, or anything about the recipient. If a fact is missing, write around it.",
  "- Never use: I hope this finds you well, reaching out, I wanted to, my name is, excited, thrilled, passionate, leverage, synergy, seamless, unlock, innovative, cutting-edge, game-changer, journey, perfect fit, pick your brain, circle back, touch base. No em dashes, no exclamation marks.",
  "",
  "Lengths: email_subject 2 to 6 words, lowercase is fine, never clickbait. email_body 50 to 110 words including greeting and sign-off. li_note at most 280 characters, no sign-off. li_message under 70 words, for after they accept the connection.",
  "Return only a JSON object with the string keys email_subject, email_body, li_note, li_message.",
].join("\n");

const SENDER = {
  name: "Adnan", title: "Founder", company: "thebridge",
  what_we_do: "thebridge is an AI R&D lab studying how groups think together. Our product, roundtable, brings up to six people together for a focused conversation. Nova, our AI co-host, helps find the right people, supports the room when invited, and turns what mattered into next steps.",
  proof_points: "(none supplied)", link: "https://thebridge.ai",
};

// Made-up recipients so no real person's data leaves this machine.
const CASES = [
  { type: "investor", organisation: "Northlight Ventures", name: "Priya Raman", role: "General Partner",
    why_they_fit: "Led the seed round of a team-collaboration startup last year", warm_path: "(none, this is a cold message)", notes: "(none)",
    the_ask: "A 20-minute call to see if we fit your pre-seed thesis." },
  { type: "partner", organisation: "Circle Leaders Network", name: "Tom Okafor", role: "Head of Partnerships",
    why_they_fit: "Runs monthly peer circles for 2,000 team leads", warm_path: "Met at the Future of Work meetup in October", notes: "(none)",
    the_ask: "A pilot where a few of your circles run on roundtable." },
  { type: "conference", organisation: "Collective Minds Summit", name: "(unknown)", role: "(unknown)",
    why_they_fit: "Annual summit on group decision-making", warm_path: "(none, this is a cold message)", notes: "(none)",
    the_ask: "A speaking slot or a hosted roundtable session at your event." },
];

const userMessage = (c) => {
  const { the_ask, ...recipient } = c;
  return `Write the outreach for this recipient.\n\n${JSON.stringify({ sender: SENDER, recipient, the_ask }, null, 2)}`;
};

async function runClaude(model, c) {
  const client = new Anthropic();
  // Every model at high effort: cost is not a concern, writing quality is.
  const response = await client.beta.messages.create({
    model, max_tokens: 16000, system: SYSTEM,
    output_config: { effort: "high" },
    ...(model === "claude-haiku-5-5" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
    messages: [{ role: "user", content: userMessage(c) }],
  });
  if (response.stop_reason === "refusal") throw new Error("declined");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, inTok: response.usage.input_tokens, outTok: response.usage.output_tokens };
}

async function runOpenAI(model, c) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions: SYSTEM, input: userMessage(c), reasoning: { effort: "high" } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const text = data.output_text ?? (data.output || []).flatMap((o) => o.content || []).filter((p) => p.type === "output_text").map((p) => p.text).join("");
  return { text, inTok: data.usage?.input_tokens ?? 0, outTok: data.usage?.output_tokens ?? 0 };
}

// Stock phrases that make outreach read as machine-written or templated.
const SLOP = [/hope (this|you're|you are)/i, /reach(ing)? out/i, /\bleverag/i, /\bdelve/i, /\bexcited\b/i, /game[- ]chang/i,
  /\bsynerg/i, /\bseamless/i, /\bunlock/i, /revolutioni[sz]/i, /\bcame across\b/i, /\bi'd love to\b/i, /\bquick question\b/i,
  /intersection of/i, /\bempower/i, /\bcutting[- ]edge\b/i, /\binnovative\b/i, /\bpassionate\b/i, /\bthrilled\b/i,
  /\bin today's\b/i, /\btouch base\b/i, /\bcircle back\b/i, /\bgroundbreaking\b/i, /\btransformative\b/i, /\bjourney\b/i];

// Mechanical checks of the prompt's own rules; tone and persuasiveness are judged by reading the report.
function check(text, c) {
  const issues = [];
  let d;
  try { d = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return { draft: null, issues: ["not valid JSON"] }; }
  for (const k of ["email_subject", "email_body", "li_note", "li_message"]) if (typeof d[k] !== "string" || !d[k].trim()) issues.push(`missing ${k}`);
  const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
  if (words(d.email_subject) >= 9) issues.push(`subject ${words(d.email_subject)} words`);
  if (words(d.email_body) >= 130) issues.push(`email ${words(d.email_body)} words`);
  if (String(d.li_note || "").length > 280) issues.push(`LinkedIn note ${d.li_note.length} chars`);
  if (words(d.li_message) >= 80) issues.push(`LinkedIn message ${words(d.li_message)} words`);
  const all = Object.values(d).join(" ");
  if (all.includes("—")) issues.push("em dash");
  if (all.includes("!")) issues.push("exclamation mark");
  const slop = SLOP.filter((re) => re.test(all)).map((re) => re.source.replace(/\\b|\\s\?|\(\?:|\)|\\/g, ""));
  if (slop.length) issues.push(`AI-sounding: ${slop.join(", ")}`);
  if (/\d+\s?(%|x|customers|users|teams)/i.test(all) && !/2,000/.test(all)) issues.push("possible invented number");
  if (c.warm_path.startsWith("Met") && !/future of work|meetup|october/i.test(d.email_body || "")) issues.push("warm path not used");
  return { draft: d, issues };
}

const results = [];
for (const m of MODELS) {
  const hasKey = m.provider === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.OPENAI_API_KEY);
  if (!hasKey) { console.log(`skip ${m.id} (no ${m.provider} key)`); continue; }
  for (const c of CASES) {
    const t0 = Date.now();
    try {
      const r = await (m.provider === "anthropic" ? runClaude : runOpenAI)(m.id, c);
      const cost = (r.inTok * m.price[0] + r.outTok * m.price[1]) / 1e6;
      const { draft, issues } = check(r.text, c);
      results.push({ model: m.id, case: c.type, secs: (Date.now() - t0) / 1000, cost, draft, issues });
      console.log(`${m.id.padEnd(18)} ${c.type.padEnd(10)} ${((Date.now() - t0) / 1000).toFixed(1)}s $${cost.toFixed(4)} ${issues.length ? issues.join("; ") : "all rules met"}`);
    } catch (e) {
      results.push({ model: m.id, case: c.type, error: e.message });
      console.log(`${m.id.padEnd(18)} ${c.type.padEnd(10)} ERROR ${e.message}`);
    }
  }
}

const letters = [...new Set(results.map((r) => r.model))].sort(() => Math.random() - 0.5);
const label = (m) => `Writer ${String.fromCharCode(65 + letters.indexOf(m))}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const byModel = [...new Set(results.map((r) => r.model))].map((model) => {
  const rs = results.filter((r) => r.model === model && !r.error);
  return { model, ok: rs.length, rulesMet: rs.filter((r) => !r.issues.length).length, avgCost: rs.reduce((a, r) => a + r.cost, 0) / (rs.length || 1), avgSecs: rs.reduce((a, r) => a + r.secs, 0) / (rs.length || 1) };
});
fs.writeFileSync(path.join(here, "compare-report.html"), `<!doctype html><meta charset="utf-8"><title>Model comparison</title>
<style>body{font:14px/1.5 -apple-system,sans-serif;margin:24px;color:#1c1b18}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;margin:0;font:13px/1.45 inherit}.bad{color:#a23b2e}.ok{color:#2f5d50}</style>
<h1>Outreach drafts: blind comparison</h1><p>Same system prompt as the app, 3 made-up recipients. Writers are shuffled letters; read the drafts and pick the most human ones before opening the key at the bottom. Generated ${new Date().toISOString()}.</p>
${CASES.map((c) => `<h2>${esc(c.type)}: ${esc(c.organisation)}</h2><table><tr><th>Writer</th><th>Email</th><th>LinkedIn note</th><th>Checks</th></tr>
${results.filter((r) => r.case === c.type).sort((a, b) => label(a.model).localeCompare(label(b.model))).map((r) => `<tr><td>${label(r.model)}</td><td>${r.error ? `<span class="bad">${esc(r.error)}</span>` : `<b>${esc(r.draft?.email_subject)}</b><pre>${esc(r.draft?.email_body)}</pre>`}</td><td><pre>${esc(r.draft?.li_note)}</pre></td><td>${r.error ? "" : r.issues.length ? `<span class="bad">${esc(r.issues.join(", "))}</span>` : `<span class="ok">all rules met</span>`}</td></tr>`).join("")}</table>`).join("")}
<details><summary><b>Reveal which model is which</b></summary><table><tr><th>Writer</th><th>Model</th><th>Drafts</th><th>All rules met</th><th>Avg cost / draft</th><th>Avg time</th></tr>
${byModel.map((b) => `<tr><td>${label(b.model)}</td><td>${b.model}</td><td>${b.ok}</td><td>${b.rulesMet}/${b.ok}</td><td>$${b.avgCost.toFixed(4)}</td><td>${b.avgSecs.toFixed(1)}s</td></tr>`).join("")}</table></details>`);
console.log(`\nReport: ${path.join(here, "compare-report.html")}`);
