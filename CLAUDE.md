# Bridge Outreach

Read this first. It explains what the app is for, how it is built, and the rules that keep it working. Code comments explain the details; this file explains the intent.

## What it is and who it is for

One founder at **thebridge** (an AI R&D lab; product **roundtable**: up to six people in a focused conversation with an AI co-host, Nova) uses this to reach four kinds of people:

- **Investors**: firms that funded similar companies, and the partners there
- **Partners**: organisations that could run roundtables with their teams or communities
- **Conferences**: event organisers (speaking slots, hosted sessions)
- **Communities**: NGOs, nonprofits, member networks (free roundtables for members)

The loop: **find** leads, keep every lead **found**, add the good ones to the **pipeline**, look up their **email and LinkedIn** automatically, **research** a reason to write now, **draft** an email and LinkedIn messages that sound like a person wrote them, the founder **approves**, it is **sent** (Gmail compose window, or Gmail API when connected), **follow-ups** are drafted when due, and **What works** shows which messages get replies.

The bar is quality over volume. Inspiration was Monaco (monaco.com), Clay and similar tools, taken only where useful.

## The email rules (the most important part)

Drafts follow YC's six-part cold email (from an Instagram carousel the founder shared, 11 slides). **The email is about the reader, not the sender.**

1. **Subject**: short, specific, about them (their company, event, recent move). Never "collaboration opportunity" or "quick question".
2. **Opener**: one line proving you picked them (warm path, then why_now, then why_they_fit). Never open with who you are or "I'm writing because".
3. **What they get**: one plain sentence, framed as what *they* or their people get. Never paste the pitch.
4. **Proof**: only if real proof points are filled in on Your pitch. Never imply traction.
5. **Ask**: alone on its own line, small, easy to say yes to. Prefer offering something useful over asking for time.
6. **Sign-off**: the model writes **none**. Code appends the signature from Your pitch (`signatureFor` / `withSignature` in `server.mjs`).

Enforced in code, not just the prompt:
- `DRAFT_SYSTEM` and `FOLLOWUP_SYSTEM` hold the rules.
- `SLOP` regexes catch machine-sounding phrases; one rewrite pass names what to fix.
- `aboutThem()` counts I/we/our/company against you/your/their name; a draft about the sender is rewritten once.
- The founder can type free-text instructions ("Tell it what to change"); they override length and tone rules but never permit invented facts.

Model choice was tested blind (`scripts/compare-models.mjs`, reports in `scripts/`): Claude wrote the most human emails. Drafts use `claude-fable-5-2` (90s timeout, falls back to `claude-opus-5-5`). Research uses `claude-opus-5-5` with web search. Plain-words search uses `claude-haiku-5-5`. OpenAI is only a fallback when no Anthropic key is set.

## How it is built

- **`server.mjs`**: Node 24, one file. `node:sqlite` database, every API route, login, background jobs, all prompts. Serves the built UI from `dist/`.
- **`web/`**: React 19 + Vite UI using the **Astryx** design system (`@astryxdesign/core`, dark neutral theme). `npm run build` writes `dist/`. The old single-page UI is still at `/classic` (`public/index.html`).
  - `App.jsx`: shell, side navigation, global "outside links open in a new tab", lead panel / full page switching.
  - `Record.jsx`: a pipeline lead (panel or full page): score, why now, the person (email, LinkedIn, details), email, follow-up, LinkedIn, history.
  - `pages/`: Today (review queue), Pipeline, Find leads, All leads (every lead ever found, with its own panel), Follow-ups, What works, Import, Your pitch (autosaves).
  - `demo/OutreachDemo.tsx`: the sign-in page's animated product demo, built with the vendored Stageshow kit (`stageshow/kit`, MIT). ThreeUI (`@designcodeio/threeui`) draws the backgrounds; only its native components are used, never its iframe scenes.
- **Lead data** comes from the Glasser CLI (`node_modules/.bin/glasser`): Fundable for investor firms (up to 100 per search), Prospeo for people (25 per page) and for email + LinkedIn lookup (`/enrich-person`). Every lookup costs money; prices are deliberately **not** shown in the UI.
- **Background work** (`autopilot`, `personQueue`, `tick()` every 10 minutes): person lookup for every new lead, research + draft for strong leads, follow-ups when due, Gmail sync. `daily_research_cap` limits automatic spend.
- **Scoring**: `rate()` gives a score and a level (1 Dream, 2 Strong, 3 Fit, 4 Not now).

## Running it

```bash
npm install
npm run build
PORT=3000 node --max-http-header-size=131072 server.mjs
```

- Always port **3000**. The founder's laptop runs one project at a time; stop other dev servers first.
- `--max-http-header-size` avoids HTTP 431 from large localhost cookies.
- `.env` holds keys (`ANTHROPIC_API_KEY`, `APP_PASSWORD`, optional `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`). Never commit it, never print its values. `APP_PASSWORD=` (empty) on the command line runs locally without sign-in for testing.
- Lead finding needs `GLASSER_API_KEY` (set on Render; not on the laptop by default).
- `outreach.db` is the local database. Back it up before tests that write to it and restore it after.

## Deploying

- Live at **https://outreachbridge.onrender.com** (Render web service `srv-dbr4fmdg1s2s73fckfd0`, disk at `/var/data`). Build `npm ci && npm run build`, start `node server.mjs`.
- GitHub: `techadnank9/bridge-outreach`, branch `main`. Push with the `techadnank9` gh account (`gh auth switch -u techadnank9`).
- Render does not always auto-deploy. Trigger a deploy by commit through the Render API, then poll until `live`. Confirm the new code is actually served (fetch the main JS bundle and look for a new string) instead of trusting the button.
- Only push or deploy when the founder says so.

## Verifying changes

- Build, run on :3000, and check in a browser before saying something works. Check desktop (1440 wide) **and** phone (375 wide): the UI must work on phones (lead panels go full screen, bottom bars wrap, tables scroll sideways).
- WebGL backgrounds do not render in the app's browser pane; use headless Chrome with `--use-angle=swiftshader` for those.
- Paid lookups: test with one known lead, not a batch.
- Gmail sending is untested end to end (no Google OAuth client yet). "Open as Gmail draft" works without it.

## Conventions

- Plain, specific UI copy. Keep existing labels unless asked to change them.
- New settings go in `DEFAULT_SETTINGS`; new columns are added with guarded `ALTER TABLE` at startup.
- Comments explain why, in plain words.
- Commit messages describe the change for a reader; no AI attribution lines unless the session's instructions say otherwise.
