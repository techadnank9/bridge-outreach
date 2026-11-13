import { useEffect, useState } from "react";
import { Drawer } from "@astryxdesign/core/Drawer";
import { DrawerHeader } from "@astryxdesign/core/Drawer";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Banner } from "@astryxdesign/core/Banner";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import {
  Sparkles, Send, Mail, Copy, UserRound, Search, Globe, AtSign, Wand2, CheckCheck, CalendarCheck, Ban, Trash2, Save, Telescope, Maximize2, ArrowLeft, X, FileText,
} from "lucide-react";
import { useApp, safeUrl, linkedinSearch, gmailCompose, copyText, fmtDate, daysSince, followupsSentCount, title, person } from "./data.js";
import { Grade, Kind, Level, Stage, DreamStar, WhyNow } from "./bits.jsx";

const LI_NOTE_LIMIT = 300;

function Field({ label, value, onSave, rows, description }) {
  const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  const blur = () => { if (v !== (value || "")) onSave(v); };
  // Saves when focus leaves the field, like the rest of the app.
  return (
    <div onBlur={blur}>
      {rows
        ? <TextArea label={label} value={v} onChange={setV} rows={rows} description={description} />
        : <TextInput label={label} value={v} onChange={setV} description={description} />}
    </div>
  );
}

function Outreach({ c }) {
  const { S, act, toast } = useApp();
  const [notice, setNotice] = useState("");
  const li = safeUrl(c.linkedin);
  const site = safeUrl(c.website);
  const r = c.rating;
  const hasDraft = c.email_body || c.li_note || c.li_message;
  const save = (key) => (value) => act("PUT", `/api/contacts/${c.id}`, { [key]: value });
  const fuN = followupsSentCount(S, c.id) + 1;
  const showFollowup = c.last_contacted && c.email_body && !["Replied", "Meeting", "Passed"].includes(c.stage);
  const [ask, setAsk] = useState("");
  const write = async (style, instruction) => {
    try {
      const d = await act("POST", `/api/contacts/${c.id}/draft`, instruction ? { instruction } : style ? { style } : undefined);
      setNotice(d.warning || "");
      if (instruction && !d.warning) { setAsk(""); toast({ body: "Rewritten with your instructions" }); }
    } catch (e) { setNotice(e.message); }
  };
  const log = async (channel, summary) => { await act("POST", `/api/contacts/${c.id}/sent`, { channel, summary }); toast({ body: "Logged" }); };

  return (
    <VStack gap={4}>
      {notice && <Banner status="warning" title={notice} isDismissable onDismiss={() => setNotice("")} />}

      <Card padding={4} variant="muted">
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" wrap="wrap"><Heading level={4}>Why they scored {r.score}</Heading><Grade rating={r} /><Level rating={r} /></HStack>
          <ul className="why-list">{r.why.map((w) => <li key={w}>{w.replace(/ \+\d+$/, "")}</li>)}</ul>
          <Text size="sm" color="secondary">{r.category}{r.level <= 2 ? " · strong leads are researched and drafted automatically" : ""}</Text>
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={2}>
          <Heading level={4}>Why now</Heading>
          {c.why_now ? <WhyNow item={c} /> : <Text size="sm" color="secondary">{c.researched_at ? "Nothing recent turned up in the last search." : "Not researched yet."}</Text>}
          {S.research.enabled && (
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button size="sm" icon={<Telescope size={14} />} label={c.researched_at ? "Research again" : "Research now"} clickAction={() => act("POST", `/api/contacts/${c.id}/research`)} />
              <Text size="xsm" color="secondary">Searches the web for a recent, specific reason to write. Takes up to a minute.</Text>
            </HStack>
          )}
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={2}>
          <Heading level={4}>1. Find the right person</Heading>
          <Text>{c.name ? `${c.name}${c.role ? ", " + c.role : ""} at ${c.org || "their organisation"}` : `No person recorded yet for ${title(c)}.`}</Text>
          <HStack gap={2} wrap="wrap">
            {li && <Button size="sm" icon={<UserRound size={14} />} label="Open LinkedIn profile" href={li} />}
            <Button size="sm" icon={<Search size={14} />} label={c.name ? "Search LinkedIn for them" : "Search LinkedIn for who to contact"} href={linkedinSearch(c)} />
            {site && <Button size="sm" icon={<Globe size={14} />} label="Website" href={site} />}
            {!c.email && S.leads.enabled && (c.linkedin || c.name) && (
              <Button size="sm" icon={<AtSign size={14} />} label={`Find email · $${Number(S.leads.pricePerLookup).toFixed(2)}`} clickAction={async () => {
                const d = await act("POST", `/api/contacts/${c.id}/find-email`);
                if (d.found) toast({ body: `Email found. Charged $${Number(d.charge).toFixed(2)}.` });
                else setNotice("No verified email was found for this person, so nothing was charged.");
              }} />
            )}
          </HStack>
          {!c.fit && <Text size="sm" color="secondary">Add a line under "Why they fit" before drafting. Without it the message will read as generic.</Text>}
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Heading level={4}>2. Email</Heading>
            {c.review === "pending" && <Badge variant="info" label="Waiting for your yes" />}
          </HStack>
          <HStack gap={2} wrap="wrap">
            <Button variant={hasDraft ? "secondary" : "primary"} icon={<Sparkles size={14} />} label={hasDraft ? "Rewrite drafts" : "Write drafts"} clickAction={() => write("")} />
            {S.ai && hasDraft && ["warmer", "shorter", "plainer"].map((st) => (
              <Button key={st} size="sm" variant="ghost" icon={<Wand2 size={14} />} label={st[0].toUpperCase() + st.slice(1)} clickAction={() => write(st)} />
            ))}
          </HStack>
          {S.ai && (
            <div className="ask-box">
              <TextArea label="Tell it what to change" rows={3} value={ask} onChange={setAsk}
                placeholder={'e.g. "Lead with the Nova demo, not the fund. Less formal, no bullet points. Mention we met at SaaStr."'}
                description="Rewrites the subject, email and both LinkedIn messages together. Your instructions win over the usual length and tone rules." />
              <HStack gap={2}>
                <Button variant="primary" size="sm" icon={<Wand2 size={14} />} label={hasDraft ? "Rewrite with this" : "Write with this"}
                  isDisabled={!ask.trim()} clickAction={() => write("", ask.trim())} />
              </HStack>
            </div>
          )}
          <Text size="xsm" color="secondary">{S.ai ? `Written by ${S.aiModel} from your pitch and this person's details, then checked for phrases that sound machine-written.` : "Built from a template using your pitch and this person's details."} Edits save when you click away.</Text>
          <Field label="Subject" value={c.email_subject} onSave={save("email_subject")} />
          <Field label="Body" value={c.email_body} onSave={save("email_body")} rows={10} />
          <HStack gap={2} wrap="wrap">
            {S.gmail.connected && ["Research", "Ready"].includes(c.stage) && (
              <Button variant="primary" icon={<Send size={14} />} label="Approve and send" isDisabled={!c.email}
                clickAction={async () => { await act("POST", `/api/contacts/${c.id}/send`, { which: "first", subject: c.email_subject, body: c.email_body }); toast({ body: "Sent from Gmail" }); }} />
            )}
            {S.gmail.connected ? (
              <Button size="sm" variant={c.gmail_draft_at ? "secondary" : "primary"} icon={<FileText size={14} />} label={c.gmail_draft_at ? "Update Gmail draft" : "Save to Gmail drafts"} isDisabled={!c.email || !c.email_body}
                clickAction={async () => {
                  try { await act("POST", `/api/contacts/${c.id}/gmail-draft`, { email_subject: c.email_subject, email_body: c.email_body }); toast({ body: "Saved in your Gmail drafts" }); }
                  catch (e) { setNotice(e.message); }
                }} />
            ) : (
              <Button size="sm" icon={<Mail size={14} />} label="Open in Gmail" isDisabled={!c.email} href={c.email ? gmailCompose(c.email, c.email_subject, c.email_body) : undefined} />
            )}
            <Button size="sm" icon={<Copy size={14} />} label="Copy" onClick={() => copyText(`${c.email_subject}\n\n${c.email_body}`, toast, "Email copied")} />
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" icon={<CheckCheck size={14} />} label="Mark email sent" clickAction={() => log("email")} />
          </HStack>
          {c.gmail_draft_at && (
            <HStack gap={2} vAlign="center" wrap="wrap" className="in-drafts">
              <Badge variant="success" label="In Gmail drafts" />
              <Text size="xsm" color="secondary">Saved {fmtDate(c.gmail_draft_at)}. Edits here need "Update Gmail draft" to reach it.</Text>
              <Button size="sm" variant="ghost" icon={<Mail size={14} />} label="Open draft"
                href={c.gmail_draft_msg ? `https://mail.google.com/mail/u/0/#drafts?compose=${c.gmail_draft_msg}` : "https://mail.google.com/mail/u/0/#drafts"} />
            </HStack>
          )}
          {!S.gmail.connected && c.email && <Text size="xsm" color="secondary">Connect Gmail on Your pitch to save this straight into your Gmail drafts instead of opening a compose window.</Text>}
          {!c.email && <Text size="sm" color="secondary">Add their email under Details to open this straight in your mail.</Text>}
        </VStack>
      </Card>

      {showFollowup && (
        <Card padding={4}>
          <VStack gap={3}>
            <Heading level={4}>Follow-up {fuN <= 3 ? `${fuN} of 3` : ""}</Heading>
            {fuN > 3 ? <Text size="sm" color="secondary">Three follow-ups sent with no reply. More rarely helps: mark them as passed, or wait.</Text> : (
              <>
                <Text size="sm" color="secondary">Shorter than the first email, with one new thing each time. {daysSince(c.last_contacted)} days since you last wrote.</Text>
                <HStack><Button variant={c.followup_body ? "secondary" : "primary"} icon={<Sparkles size={14} />} label={c.followup_body ? "Rewrite follow-up" : "Write follow-up"}
                  clickAction={async () => { try { await act("POST", `/api/contacts/${c.id}/followup`); } catch (e) { setNotice(e.message); } }} /></HStack>
                {c.followup_body && (
                  <>
                    <Field label="Subject" value={c.followup_subject} onSave={save("followup_subject")} />
                    <Field label="Body" value={c.followup_body} onSave={save("followup_body")} rows={7} />
                    <HStack gap={2} wrap="wrap">
                      {S.gmail.connected && <Button variant="primary" icon={<Send size={14} />} label="Send in the same thread" isDisabled={!c.email}
                        clickAction={async () => { await act("POST", `/api/contacts/${c.id}/send`, { which: "followup", subject: c.followup_subject, body: c.followup_body }); toast({ body: "Follow-up sent" }); }} />}
                      <Button size="sm" icon={<Mail size={14} />} label="Open in Gmail" isDisabled={!c.email} href={c.email ? gmailCompose(c.email, c.followup_subject, c.followup_body) : undefined} />
                      <Button size="sm" icon={<Copy size={14} />} label="Copy" onClick={() => copyText(c.followup_body, toast, "Follow-up copied")} />
                      <span style={{ flex: 1 }} />
                      <Button size="sm" variant="ghost" icon={<CheckCheck size={14} />} label="Mark follow-up sent" clickAction={() => log("email", `Follow-up ${fuN} sent`)} />
                    </HStack>
                  </>
                )}
              </>
            )}
          </VStack>
        </Card>
      )}

      <Card padding={4}>
        <VStack gap={3}>
          <Heading level={4}>3. LinkedIn</Heading>
          <Text size="sm" color="secondary">LinkedIn does not allow tools to send messages for you, so this copies the text and opens their profile. You paste and send.</Text>
          <Field label="Connection request note" value={c.li_note} onSave={save("li_note")} rows={3}
            description={`${(c.li_note || "").length} / ${LI_NOTE_LIMIT} characters`} />
          <HStack gap={2} wrap="wrap">
            <Button size="sm" icon={<Copy size={14} />} label={li ? "Copy and open profile" : "Copy"} onClick={async () => { await copyText(c.li_note || "", toast, "Note copied"); if (li) window.open(li, "_blank", "noopener"); }} />
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" icon={<CheckCheck size={14} />} label="Mark request sent" clickAction={() => log("linkedin_note")} />
          </HStack>
          <Field label="Message once connected" value={c.li_message} onSave={save("li_message")} rows={4} />
          <HStack gap={2} wrap="wrap">
            <Button size="sm" icon={<Copy size={14} />} label={li ? "Copy and open profile" : "Copy"} onClick={async () => { await copyText(c.li_message || "", toast, "Message copied"); if (li) window.open(li, "_blank", "noopener"); }} />
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" icon={<CheckCheck size={14} />} label="Mark message sent" clickAction={() => log("linkedin_message")} />
          </HStack>
        </VStack>
      </Card>

      <Card padding={4}>
        <VStack gap={2}>
          <Heading level={4}>4. What happened</Heading>
          <HStack gap={2} wrap="wrap">
            <Button size="sm" icon={<Mail size={14} />} label="They replied" clickAction={() => log("reply")} />
            <Button size="sm" icon={<CalendarCheck size={14} />} label="Meeting booked" clickAction={() => log("meeting")} />
            <Button size="sm" variant="ghost" icon={<Ban size={14} />} label="Passed" clickAction={async () => { await act("PUT", `/api/contacts/${c.id}`, { stage: "Passed" }); toast({ body: "Marked as passed" }); }} />
          </HStack>
        </VStack>
      </Card>
    </VStack>
  );
}

function Details({ c, onClose }) {
  const { S, act, toast } = useApp();
  const [f, setF] = useState({ ...c });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const keys = ["kind", "stage", "org", "website", "name", "role", "email", "linkedin", "fit", "warm_path", "notes"];
  return (
    <VStack gap={3}>
      <Grid columns={2} gap={3}>
        <Selector label="Type" options={S.kinds} value={f.kind} onChange={set("kind")} />
        <Selector label="Stage" options={S.stages} value={f.stage} onChange={set("stage")} />
        <TextInput label="Organisation (firm, company or event)" value={f.org || ""} onChange={set("org")} />
        <TextInput label="Website" value={f.website || ""} onChange={set("website")} />
        <TextInput label="Person" value={f.name || ""} onChange={set("name")} />
        <TextInput label="Their role" value={f.role || ""} onChange={set("role")} />
        <TextInput label="Email" type="email" value={f.email || ""} onChange={set("email")} />
        <TextInput label="LinkedIn profile URL" value={f.linkedin || ""} onChange={set("linkedin")} />
      </Grid>
      <TextArea label="Why they fit" rows={3} value={f.fit || ""} onChange={set("fit")} description="One or two sentences. This is what makes the draft specific to them." />
      <TextInput label="Warm path" value={f.warm_path || ""} onChange={set("warm_path")} description="Who can introduce you, if anyone. Leave empty for a cold message." />
      <TextArea label="Notes" rows={3} value={f.notes || ""} onChange={set("notes")} />
      <HStack gap={2}>
        <Button variant="primary" icon={<Save size={14} />} label="Save" clickAction={async () => {
          const body = {}; keys.forEach((k) => (body[k] = f[k] ?? ""));
          await act("PUT", `/api/contacts/${c.id}`, body); toast({ body: "Saved" });
        }} />
        <span style={{ flex: 1 }} />
        <Button variant="destructive" icon={<Trash2 size={14} />} label="Delete" clickAction={async () => {
          if (!confirm(`Delete ${title(c)} and its history? This cannot be undone.`)) return;
          await act("DELETE", `/api/contacts/${c.id}`); onClose(); toast({ body: "Deleted" });
        }} />
      </HStack>
    </VStack>
  );
}

function History({ c }) {
  const { S, act } = useApp();
  const [note, setNote] = useState("");
  const items = S.activity.filter((a) => a.contact_id === c.id);
  return (
    <VStack gap={4}>
      <Card padding={4}><VStack gap={2}>
        <TextArea label="Add a note" placeholder="What was said, what to do next" rows={3} value={note} onChange={setNote} />
        <HStack><Button size="sm" label="Add note" isDisabled={!note.trim()} clickAction={async () => {
          await act("POST", `/api/contacts/${c.id}/sent`, { channel: "note", summary: note.trim() }); setNote("");
        }} /></HStack>
      </VStack></Card>
      <Card padding={4}><VStack gap={2}>
        <Heading level={4}>History</Heading>
        {items.length ? items.map((a) => (
          <HStack key={a.id} gap={3} hAlign="between" className="log-row">
            <Text size="sm">{a.summary}</Text><Text size="xsm" color="secondary">{fmtDate(a.at)}</Text>
          </HStack>
        )) : <Text size="sm" color="secondary">Nothing logged yet.</Text>}
      </VStack></Card>
    </VStack>
  );
}

function useRecord(id, initialTab) {
  const { S } = useApp();
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [id, initialTab]);
  return { c: S.contacts.find((x) => x.id === id), tab, setTab };
}

function Meta({ c, tab, setTab }) {
  return (
    <div className="drawer-meta">
      <HStack gap={1.5} wrap="wrap"><Kind kind={c.kind} /><Stage stage={c.stage} /><Level rating={c.rating} /></HStack>
      <TabList value={tab} onChange={setTab} size="sm" hasDivider>
        <Tab value="outreach" label="Outreach" />
        <Tab value="details" label="Details" />
        <Tab value="activity" label="History" />
      </TabList>
    </div>
  );
}

function Body({ c, tab, onClose }) {
  return tab === "details" ? <Details c={c} onClose={onClose} /> : tab === "activity" ? <History c={c} /> : <Outreach c={c} />;
}

function Lead({ c }) {
  const { act } = useApp();
  return <HStack gap={1} vAlign="center"><DreamStar item={c} onToggle={() => act("POST", `/api/contacts/${c.id}/dream`, { dream: !c.dream })} /><Avatar name={c.name || title(c)} size="md" tooltip={false} /></HStack>;
}

export function Record({ id, tab: initialTab = "outreach", onClose, onExpand }) {
  const { c, tab, setTab } = useRecord(id, initialTab);
  if (!c) return null;
  return (
    <Drawer isOpen onOpenChange={(o) => !o && onClose()} label={title(c)} side="end" width={560} hasScrim={false} padding={0}>
      <DrawerHeader
        title={title(c)}
        subtitle={person(c) || c.kind}
        onOpenChange={(o) => !o && onClose()}
        startContent={<Lead c={c} />}
        endContent={<Button size="sm" variant="ghost" icon={<Maximize2 size={14} />} label="Open full page" clickAction={() => onExpand(tab)} />}
        hasDivider={false}
      />
      <Meta c={c} tab={tab} setTab={setTab} />
      <div className="drawer-body"><Body c={c} tab={tab} onClose={onClose} /></div>
    </Drawer>
  );
}

// The same record as a page of its own, with room to read the research and drafts side by side.
export function RecordPage({ id, tab: initialTab = "outreach", onClose, onBack }) {
  const { c, tab, setTab } = useRecord(id, initialTab);
  if (!c) return <Text color="secondary">This lead is no longer in your pipeline.</Text>;
  return (
    <div className="record-page">
      <HStack gap={2} vAlign="center" wrap="wrap" className="record-page__bar">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} label="Back" clickAction={onBack} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon={<X size={14} />} label="Close" clickAction={onClose} />
      </HStack>
      <HStack gap={3} vAlign="center" className="record-page__head">
        <Lead c={c} />
        <VStack gap={0.5}><Heading level={2}>{title(c)}</Heading><Text color="secondary">{person(c) || c.kind}</Text></VStack>
      </HStack>
      <Meta c={c} tab={tab} setTab={setTab} />
      <div className="record-page__body"><Body c={c} tab={tab} onClose={onClose} /></div>
    </div>
  );
}
