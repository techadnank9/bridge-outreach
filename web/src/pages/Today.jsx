import { useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { NetworkField } from "../NetworkField.jsx";
import { Inbox, Send, PencilLine, Clock3, X } from "lucide-react";
import { useApp, reviewQueue, todayActions, followupsSentCount, gmailCompose, title, inPipeline } from "../data.js";
import { Grade, Kind, Level, WhyNow } from "../bits.jsx";

const SNOOZE = [
  { value: "3", label: "3 days" },
  { value: "7", label: "1 week" },
  { value: "14", label: "2 weeks" },
  { value: "30", label: "1 month" },
];

function ReviewCard({ c }) {
  const { S, act, toast, open } = useApp();
  const fu = c.stage === "Contacted";
  const n = followupsSentCount(S, c.id) + 1;
  const subject = fu ? c.followup_subject : c.email_subject;
  const body = fu ? c.followup_body : c.email_body;

  const approve = async () => {
    if (S.gmail.connected) {
      await act("POST", `/api/contacts/${c.id}/send`, { which: fu ? "followup" : "first", subject, body });
      toast({ body: `Sent to ${c.name || title(c)}` });
      return;
    }
    window.open(gmailCompose(c.email, subject, body), "_blank", "noopener");
    await act("POST", `/api/contacts/${c.id}/sent`, { channel: "email", summary: fu ? `Follow-up ${n} sent` : "" });
    toast({ body: "Opened in Gmail and logged as sent" });
  };

  return (
    <Card padding={4} className="review-card">
      <VStack gap={3}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Avatar name={c.name || title(c)} size="md" />
          <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Text weight="semibold">{c.name || title(c)}</Text>
            <Text size="sm" color="secondary">{[c.role, c.org].filter(Boolean).join(", ")}</Text>
          </VStack>
          <HStack gap={1.5} vAlign="center" wrap="wrap">
            <Grade rating={c.rating} />
            <Level rating={c.rating} />
            <Kind kind={c.kind} />
            {fu && <Badge variant="warning" label={`Follow-up ${n}`} />}
          </HStack>
        </HStack>
        <WhyNow item={c} />
        <div className="letter">
          <div className="letter-subject">{subject}</div>
          <div className="letter-body">{body}</div>
        </div>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button variant="primary" icon={<Send size={16} />} label={S.gmail.connected ? "Approve and send" : "Approve, open in Gmail"}
            isDisabled={!c.email} tooltip={c.email ? undefined : "Add their email first"} clickAction={approve} />
          <Button label="Edit" icon={<PencilLine size={16} />} onClick={() => open(c.id)} />
          <div style={{ width: 150 }}>
            <Selector label="Snooze" isLabelHidden placeholder="Snooze…" options={SNOOZE} value={undefined} size="md"
              startIcon={Clock3}
              onChange={async (v) => {
                if (!v) return;
                await act("POST", `/api/contacts/${c.id}/review`, { action: "snooze", days: Number(v) });
                toast({ body: `Snoozed for ${SNOOZE.find((o) => o.value === String(v))?.label}` });
              }} />
          </div>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" icon={<X size={16} />} label="Dismiss"
            clickAction={async () => {
              if (!confirm(`Dismiss ${c.name || title(c)}? They move to Passed and get no more drafts.`)) return;
              await act("POST", `/api/contacts/${c.id}/review`, { action: "dismiss" });
              toast({ body: "Dismissed" });
            }} />
        </HStack>
        {!c.email && <Text size="sm" color="secondary">No email yet. Open it to find their email or add it.</Text>}
      </VStack>
    </Card>
  );
}

export function Today() {
  const { S, go, open } = useApp();
  const [q, setQ] = useState("");
  const queue = reviewQueue(S);
  const acts = todayActions(S);
  const sent = S.insights?.sent || 0;
  const replied = S.insights?.repliedPeople || 0;

  const query = q.trim().toLowerCase();
  const hits = query ? [
    ...S.contacts.filter((c) => [c.org, c.name, c.role, c.fit].join(" ").toLowerCase().includes(query))
      .map((c) => ({ id: c.id, text: title(c), sub: [c.name, c.role].filter(Boolean).join(", ") || "In pipeline" })),
    ...(S.allLeads || []).filter((l) => !inPipeline(S, l) && [l.org, l.name, l.role, l.fit].join(" ").toLowerCase().includes(query))
      .map((l) => ({ view: "leads", text: l.org || l.name, sub: `${[l.name, l.role].filter(Boolean).join(", ") || l.kind} · lead` })),
  ].slice(0, 12) : [];

  return (
    <VStack gap={6}>
      {/* The one bold moment: your network, drawn as a live field of connected points. */}
      <div className="hero">
        <div className="hero-field" aria-hidden="true">
          <NetworkField />
        </div>
        <div className="hero-body">
          <Text size="sm" color="secondary">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
          <Heading level={1} type="display-3">{queue.length ? `${queue.length} draft${queue.length === 1 ? "" : "s"} waiting for your yes` : "Your network, today"}</Heading>
          <HStack gap={6} wrap="wrap" style={{ marginTop: 12 }}>
            <div className="hero-stat"><span>{S.contacts.length}</span><Text size="sm" color="secondary">in pipeline</Text></div>
            <div className="hero-stat"><span>{sent}</span><Text size="sm" color="secondary">messages sent</Text></div>
            <div className="hero-stat"><span>{replied}</span><Text size="sm" color="secondary">people replied</Text></div>
            {S.research.enabled && <div className="hero-stat"><span>{S.research.today}/{S.research.cap}</span><Text size="sm" color="secondary">researched today</Text></div>}
          </HStack>
          <HStack gap={2} style={{ marginTop: 18, maxWidth: 560 }}>
            <div style={{ flex: 1 }}>
              <TextInput label="Search everything" isLabelHidden placeholder="Search people, firms and leads" value={q} onChange={setQ} hasClear />
            </div>
            <Button variant="primary" label="Find leads" onClick={() => go("find")} />
          </HStack>
        </div>
      </div>

      {query ? (
        <VStack gap={2}>
          <Heading level={2}>Results</Heading>
          {hits.length ? hits.map((h, i) => (
            <Card key={i} padding={3}>
              <HStack gap={3} vAlign="center">
                <VStack gap={0} style={{ flex: 1 }}><Text weight="medium">{h.text}</Text><Text size="sm" color="secondary">{h.sub}</Text></VStack>
                <Button size="sm" label="Open" onClick={() => (h.id ? open(h.id) : go(h.view))} />
              </HStack>
            </Card>
          )) : <Text color="secondary">Nothing matches. Try a firm or a person's name.</Text>}
        </VStack>
      ) : (
        <>
          {queue.length > 0 && (
            <VStack gap={3}>
              <HStack gap={2} vAlign="center"><Heading level={2}>To review</Heading><Badge variant="info" label={String(queue.length)} /></HStack>
              <Text color="secondary">Best leads first. {S.gmail.connected ? "Approve sends it from your Gmail." : "Approve opens it in Gmail for you to send, then logs it."}</Text>
              {queue.map((c) => <ReviewCard key={c.id} c={c} />)}
            </VStack>
          )}
          <VStack gap={3}>
            <Heading level={2}>Also today</Heading>
            {acts.length ? (
              <Card padding={0}>
                {acts.map((a, i) => (
                  <div key={i} className="act-row">
                    <span className="act-n">{i + 1}</span>
                    <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text weight="medium">{a.text}</Text>
                      <Text size="sm" color="secondary">{a.sub}</Text>
                    </VStack>
                    <Button size="sm" variant={i === 0 && !queue.length ? "primary" : "secondary"} label={a.button}
                      onClick={() => (a.id ? open(a.id) : go(a.view))} />
                  </div>
                ))}
              </Card>
            ) : queue.length ? (
              <Text color="secondary">Nothing else waiting.</Text>
            ) : (
              <EmptyState icon={<Inbox size={28} />} title="Nothing waiting" description="Find leads or add a contact to get started. Strong leads are researched and drafted for you."
                actions={<Button variant="primary" label="Find leads" onClick={() => go("find")} />} />
            )}
          </VStack>
        </>
      )}
    </VStack>
  );
}
