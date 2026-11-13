import { useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Plus, Download, Users, RefreshCw, Search } from "lucide-react";
import { useApp, KIND_LABEL, daysSince, title, person } from "../data.js";
import { Grade, Kind, Level, Stage, DreamStar } from "../bits.jsx";
import { LabelsLegend } from "../bits.jsx";

export function ContactTable({ list }) {
  const { act, open } = useApp();
  const columns = [
    { key: "who", header: "Who", width: proportional(2.4, { minWidth: 220 }), renderCell: (c) => (
      <HStack gap={2} vAlign="center" style={{ minWidth: 0 }}>
        <DreamStar item={c} onToggle={() => act("POST", `/api/contacts/${c.id}/dream`, { dream: !c.dream })} />
        <button type="button" className="row-open" onClick={() => open(c.id)} aria-label={`Open ${title(c)}`}>
          <Avatar name={c.name || title(c)} size="sm" tooltip={false} />
          <VStack gap={0} style={{ minWidth: 0 }}>
            <Text weight="medium" maxLines={1}>{title(c)}</Text>
            <Text size="sm" color="secondary" maxLines={1}>{person(c) || "No person yet"}</Text>
          </VStack>
        </button>
      </HStack>
    ) },
    { key: "score", header: "Score", width: pixel(170), renderCell: (c) => <HStack gap={1.5} vAlign="center"><Grade rating={c.rating} /><Level rating={c.rating} /></HStack> },
    { key: "kind", header: "Type", width: pixel(120), renderCell: (c) => <Kind kind={c.kind} /> },
    { key: "email", header: "Email", width: proportional(1.3, { minWidth: 170 }), renderCell: (c) => c.email
      ? <Text size="sm" maxLines={1}>{c.email}</Text>
      : <Text size="sm" color="secondary">{c.person_checked_at || !(c.linkedin || c.name) ? "Not found" : "Looking up…"}</Text> },
    { key: "fit", header: "Why they fit", width: proportional(2, { minWidth: 160 }), renderCell: (c) => <Text size="sm" color="secondary" maxLines={2}>{c.why_now || c.fit}</Text> },
    { key: "have", header: "Have", width: pixel(150), renderCell: (c) => (
      <HStack gap={1}>
        {[["email", c.email], ["LinkedIn", c.linkedin], ["draft", c.email_body]].map(([label, ok]) => (
          <span key={label} className={`have${ok ? " yes" : ""}`}>{label}</span>
        ))}
      </HStack>
    ) },
    { key: "stage", header: "Stage", width: pixel(120), renderCell: (c) => <Stage stage={c.stage} /> },
    { key: "last", header: "Last contact", width: pixel(110), renderCell: (c) => {
      const d = daysSince(c.last_contacted);
      return <Text size="sm" color="secondary">{d === null ? "" : d === 0 ? "today" : `${d}d ago`}</Text>;
    } },
  ];
  return (
    <div className="table-wrap">
      <Table data={list} columns={columns} idKey="id" hasHover density="compact" verticalAlign="middle" />
    </div>
  );
}

export function Pipeline() {
  const { S, act, toast, open } = useApp();
  const [kind, setKind] = useState("all");
  const [stage, setStage] = useState("all");
  const [q, setQ] = useState("");
  const pool = S.contacts.filter((c) => kind === "all" || c.kind === kind);
  const query = q.toLowerCase();
  const list = pool.filter((c) => (stage === "all" || c.stage === stage) &&
    (!query || [c.org, c.name, c.role, c.fit, c.notes].join(" ").toLowerCase().includes(query)));

  const addContact = async () => {
    const r = await act("POST", "/api/contacts", { kind: kind === "all" ? "investor" : kind, org: "New contact", stage: "Research" });
    open(r.contact.id, "details");
  };

  return (
    <VStack gap={5}>
      <HStack gap={3} vAlign="end" wrap="wrap">
        <VStack gap={1} style={{ flex: 1, minWidth: 260 }}>
          <Heading level={1}>Pipeline</Heading>
          <Text color="secondary">Everyone you want to reach. Open a row to find the right person, draft the email and LinkedIn message, and log what you sent.</Text>
        <LabelsLegend />
        </VStack>
        <HStack gap={2}>
          {S.gmail.connected && <Button label="Check Gmail" icon={<RefreshCw size={16} />} clickAction={async () => {
            const r = await act("POST", "/api/gmail/sync", {});
            toast({ body: r.found ? `Gmail: ${r.found.sent} sent, ${r.found.replies} replies found` : "Gmail checked" });
          }} />}
          <Button label="Export CSV" icon={<Download size={16} />} href="/api/export.csv" />
          <Button variant="primary" label="Add contact" icon={<Plus size={16} />} clickAction={addContact} />
        </HStack>
      </HStack>

      <div className="stage-strip">
        {S.stages.map((s) => {
          const n = pool.filter((c) => c.stage === s).length;
          return (
            <button key={s} type="button" className={`stage-tile${stage === s ? " on" : ""}`} onClick={() => setStage(stage === s ? "all" : s)}>
              <span className="stage-n">{n}</span><Text size="sm" color="secondary">{s}</Text>
            </button>
          );
        })}
      </div>

      <HStack gap={3} vAlign="center" wrap="wrap">
        <TabList value={kind} onChange={setKind} size="sm">
          <Tab value="all" label="All" />
          {S.kinds.map((k) => <Tab key={k} value={k} label={KIND_LABEL[k] || k} />)}
        </TabList>
        <div style={{ width: 280 }}><TextInput label="Search contacts" isLabelHidden placeholder="Search" value={q} onChange={setQ} startIcon={Search} hasClear /></div>
      </HStack>

      {list.length ? <ContactTable list={list} /> : (
        <EmptyState icon={<Users size={28} />}
          title={S.contacts.length ? "Nothing matches these filters" : "No contacts yet"}
          description={S.contacts.length ? "Clear the search or pick another stage." : "Add your first investor or partner, or paste a list on the Import page."}
          actions={!S.contacts.length && <Button variant="primary" label="Add contact" clickAction={addContact} />} />
      )}
    </VStack>
  );
}
