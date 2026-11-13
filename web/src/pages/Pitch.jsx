import { useEffect, useRef, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Code } from "@astryxdesign/core/Code";
import { Mail, Unplug, Check, Loader2 } from "lucide-react";
import { useApp } from "../data.js";

export function Pitch() {
  const { S, act, toast } = useApp();
  const [s, setS2] = useState({ ...S.settings });
  const set = (k) => (v) => setS2((prev) => ({ ...prev, [k]: v }));
  const line = (k, label, description) => <TextInput label={label} value={s[k] || ""} onChange={set(k)} description={description} />;
  const area = (k, label, description, rows = 3) => <TextArea label={label} value={s[k] || ""} onChange={set(k)} description={description} rows={rows} />;
  // Every change saves itself a moment after you stop typing; no Save button to scroll to.
  const [status, setStatus] = useState("saved");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setStatus("saving");
    const t = setTimeout(async () => {
      try { await act("PUT", "/api/settings", s); setStatus("saved"); } catch { setStatus("failed"); }
    }, 700);
    return () => clearTimeout(t);
  }, [s, act]);

  return (
    <VStack gap={5} style={{ maxWidth: 880 }}>
      <VStack gap={1}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Heading level={1}>Your pitch</Heading>
          <span className={`autosave autosave--${status}`}>
            {status === "saving" ? <><Loader2 size={13} className="spin" /> Saving…</> : status === "failed" ? "Not saved, check your connection" : <><Check size={13} /> All changes saved</>}
          </span>
        </HStack>
        <Text color="secondary">Every draft is built from what you write here plus what you know about the person. The more specific this is, the less each draft needs editing.</Text>
      </VStack>

      <Card padding={5}><VStack gap={3}>
        <Heading level={3}>Who is writing</Heading>
        <Grid columns={2} gap={3}>
          {line("founder_name", "Your name")}{line("founder_title", "Your title")}
          {line("company", "Company")}{line("link", "Link to share")}
        </Grid>
      </VStack></Card>

      <Card padding={5}><VStack gap={3}>
        <Heading level={3}>What you say</Heading>
        {area("pitch", "What the company does, in two or three sentences")}
        {area("proof", "Proof points", "Real numbers or names only: pilots run, waitlist size, notable users. Leave empty if there are none yet.", 2)}
      </VStack></Card>

      <Card padding={5}><VStack gap={3}>
        <Heading level={3}>What you ask for</Heading>
        <Grid columns={2} gap={3}>
          {area("investor_ask", "From investors", "", 2)}{area("partner_ask", "From partners", "", 2)}
          {area("conference_ask", "From conferences", "", 2)}{area("community_ask", "From communities", "", 2)}
        </Grid>
        <div style={{ width: 260 }}><NumberInput label="Follow up after this many days" value={Number(s.followup_days) || 5} min={1} onChange={(v) => set("followup_days")(String(v ?? 5))} /></div>
      </VStack></Card>

      <Card padding={5}><VStack gap={3}>
        <Heading level={3}>Your voice</Heading>
        {area("voice_samples", "Two or three emails you wrote yourself", "Paste real messages you sent, to anyone. Drafts copy your tone, length, greeting and sign-off, never your sentences.", 6)}
        {line("booking_link", "Booking link", "Your Calendly or Cal.com link. Added after the ask in emails to dream-tier leads.")}
      </VStack></Card>

      <Card padding={5}><VStack gap={3}>
        <Heading level={3}>Automation</Heading>
        {area("block_list", "Block list", "One per line: a firm, a person, an email address or a website. They are left out of searches and never researched or drafted.", 4)}
        <div style={{ width: 260 }}><NumberInput label="Automatic work per day" value={Number(s.daily_research_cap) || 0} min={0} onChange={(v) => set("daily_research_cap")(String(v ?? 0))}
          description="How many leads a day can be researched, looked up and drafted automatically (about $0.10 to $0.20 each). 0 turns it off." /></div>
      </VStack></Card>

      <Card padding={5}><VStack gap={3}>
        <HStack gap={2} vAlign="center"><Mail size={18} /><Heading level={3}>Gmail</Heading>
          <StatusDot variant={S.gmail.connected ? "success" : "warning"} label={S.gmail.connected ? "Connected" : "Not connected"} /></HStack>
        {S.gmail.connected ? (
          <>
            <Text>Connected{S.gmail.address ? ` as ${S.gmail.address}` : ""}. Approved emails send from this inbox, follow-ups go in the same thread, and replies stop the sequence.</Text>
            <Text size="sm" color="secondary">This app sends only the emails you approve, saves drafts, and reads your mail to spot sends and replies so follow-ups stop when someone answers.</Text>
            <HStack><Button variant="destructive" icon={<Unplug size={16} />} label="Disconnect Gmail" clickAction={async () => {
              if (!confirm("Disconnect Gmail? Drafts already saved stay in your inbox.")) return;
              await act("POST", "/api/gmail/disconnect"); toast({ body: "Gmail disconnected" });
            }} /></HStack>
          </>
        ) : S.gmail.configured ? (
          <>
            <Text>Connect Gmail to send approved emails from your own address and to have replies update the pipeline automatically.</Text>
            <HStack><Button variant="primary" label="Connect Gmail" href="/auth/google" /></HStack>
          </>
        ) : (
          <>
            <Text>Gmail is not set up yet. It needs a Google sign-in client, which takes about ten minutes to create once:</Text>
            <ol className="steps">
              <li>In Google Cloud Console, create a project and enable the Gmail API.</li>
              <li>Set up the consent screen and add yourself as a test user.</li>
              <li>Create an OAuth client of type "Web application" with this redirect URI: <Code>{S.gmail.redirect}</Code></li>
              <li>Add the client ID and secret to the service as <Code>GOOGLE_CLIENT_ID</Code> and <Code>GOOGLE_CLIENT_SECRET</Code>, then redeploy.</li>
            </ol>
          </>
        )}
      </VStack></Card>
    </VStack>
  );
}
