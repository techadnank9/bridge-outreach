import { useMemo, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Drawer, DrawerHeader } from "@astryxdesign/core/Drawer";
import { Card } from "@astryxdesign/core/Card";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Users, Plus, Trash2, Search, UserRound, Globe, Maximize2, ArrowLeft, X, ArrowRight } from "lucide-react";
import { useApp, inPipeline, fmtDate, safeUrl, KIND_LABEL, linkedinSearch } from "../data.js";
import { Grade, Kind, Level, DreamStar } from "../bits.jsx";
import { LabelsLegend } from "../bits.jsx";

const CATEGORIES = ["Decision maker", "Influencer", "Contact", "Firm only"];

const contactFor = (S, l) =>
  S.contacts.find((c) => (c.org || "").toLowerCase() === (l.org || "").toLowerCase() && (c.name || "").toLowerCase() === (l.name || "").toLowerCase());

// What a found lead is, before it is in the pipeline: who, why they scored, and what to do with them.
function LeadBody({ l, onLeave }) {
  const { S, act, toast, open } = useApp();
  const li = safeUrl(l.linkedin);
  const site = safeUrl(l.website);
  const contact = contactFor(S, l);
  return (
    <VStack gap={4}>
      <Card padding={4}>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" wrap="wrap"><Heading level={4}>Score {l.rating?.score}</Heading><Grade rating={l.rating} /><Level rating={l.rating} /></HStack>
          <ul className="why-list">{(l.rating?.why || []).map((w) => <li key={w}>{w.replace(/ \+\d+$/, "")}</li>)}</ul>
          <Text size="sm" color="secondary">{l.rating?.category}</Text>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={2}>
          <Heading level={4}>The person</Heading>
          <Text>{l.name ? `${l.name}${l.role ? ", " + l.role : ""}` : "No person found at this organisation yet."}</Text>
          <dl className="person-facts">
            <dt>LinkedIn</dt>
            <dd>{li ? <Button size="sm" icon={<UserRound size={14} />} label="Open LinkedIn profile" href={li} />
              : <HStack gap={2} vAlign="center" wrap="wrap"><Text size="sm" color="secondary">No profile found.</Text><Button size="sm" variant="ghost" icon={<Search size={14} />} label="Search LinkedIn" href={linkedinSearch(l)} /></HStack>}</dd>
            <dt>Email</dt>
            <dd><Text size="sm" color="secondary">{l.email_available ? "Available. Found automatically once added to the pipeline." : "Looked up once added to the pipeline."}</Text></dd>
            {site && <><dt>Website</dt><dd><Button size="sm" variant="ghost" icon={<Globe size={14} />} label={site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} href={site} /></dd></>}
            <dt>Found</dt>
            <dd><Text size="sm" color="secondary">{fmtDate(l.found_at)}{l.search ? ` · searching "${l.search}"` : ""}</Text></dd>
          </dl>
        </VStack>
      </Card>
      {l.fit && <Card padding={4}><VStack gap={2}><Heading level={4}>Why they fit</Heading><Text>{l.fit}</Text></VStack></Card>}
      <HStack gap={2} wrap="wrap">
        {contact ? (
          <Button variant="primary" icon={<ArrowRight size={16} />} label="Open in pipeline" clickAction={() => { onLeave(); open(contact.id); }} />
        ) : (
          <Button variant="primary" icon={<Plus size={16} />} label="Add to pipeline" clickAction={async () => {
            const r = await act("POST", "/api/leads/add", { rows: [l] });
            toast({ body: r.added ? "Added. Email, LinkedIn and a draft are being prepared." : "Already in your pipeline" });
          }} />
        )}
        {!contact && <Button icon={<Trash2 size={16} />} label="Remove from list" clickAction={async () => {
          if (!confirm(`Remove ${l.name || l.org} from this list? A new search can find them again.`)) return;
          await act("POST", "/api/leads/forget", { ids: [l.id] });
        }} />}
      </HStack>
    </VStack>
  );
}

function LeadHead({ l }) {
  const { act } = useApp();
  return <HStack gap={1} vAlign="center"><DreamStar item={l} onToggle={() => act("POST", "/api/leads/dream", { id: l.id, dream: !l.dream })} /><Avatar name={l.name || l.org} size="md" tooltip={false} /></HStack>;
}

export function Leads() {
  const { S, act, toast } = useApp();
  const [shown, setShown] = useState(null); // { id, full }
  const [status, setStatus] = useState("new");
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(new Set());
  const all = S.allLeads || [];

  const list = useMemo(() => {
    const query = q.toLowerCase();
    return all.filter((l) =>
      (kind === "all" || l.kind === kind) &&
      (status === "all" || (status === "pipeline") === inPipeline(S, l)) &&
      (category === "all" || l.rating?.category === category) &&
      (!query || [l.org, l.name, l.role, l.fit, l.search].join(" ").toLowerCase().includes(query)))
      .sort((a, b) => (a.rating?.level || 4) - (b.rating?.level || 4) || (b.rating?.score || 0) - (a.rating?.score || 0));
  }, [all, kind, status, category, q, S.contacts.length]);

  const pickable = list.filter((l) => !inPipeline(S, l));
  const sel = [...picked].filter((id) => pickable.some((l) => l.id === id));
  const counts = { new: all.filter((l) => !inPipeline(S, l)).length, pipeline: all.filter((l) => inPipeline(S, l)).length, all: all.length };

  const columns = [
    { key: "pick", header: "", width: pixel(84), renderCell: (l) => (
      <HStack gap={1} vAlign="center">
        {inPipeline(S, l) ? <Text color="secondary" size="sm" style={{ width: 20, textAlign: "center" }}>✓</Text> : (
          <CheckboxInput label={`Select ${l.name || l.org}`} isLabelHidden value={picked.has(l.id)}
            onChange={(v) => { const n = new Set(picked); v ? n.add(l.id) : n.delete(l.id); setPicked(n); }} />
        )}
        <DreamStar item={l} onToggle={() => act("POST", "/api/leads/dream", { id: l.id, dream: !l.dream })} />
      </HStack>
    ) },
    { key: "org", header: "Lead", width: proportional(2.2, { minWidth: 200 }), renderCell: (l) => (
      <button type="button" className="row-open" onClick={() => setShown({ id: l.id, full: false })} aria-label={`Open ${l.org}`}>
        <Avatar name={l.name || l.org} size="sm" tooltip={false} />
        <VStack gap={0} style={{ minWidth: 0 }}>
          <Text weight="medium" maxLines={1}>{l.org}</Text>
          <Text size="sm" color="secondary" maxLines={1}>{l.name ? `${l.name}${l.role ? ", " + l.role : ""}` : "No person found"}</Text>
        </VStack>
      </button>
    ) },
    { key: "score", header: "Score", width: pixel(170), renderCell: (l) => <HStack gap={1.5} vAlign="center"><Grade rating={l.rating} /><Level rating={l.rating} /></HStack> },
    { key: "category", header: "Category", width: pixel(130), renderCell: (l) => <Text size="sm" color="secondary">{l.rating?.category}</Text> },
    { key: "kind", header: "Type", width: pixel(120), renderCell: (l) => <Kind kind={l.kind} /> },
    { key: "fit", header: "Why they fit", width: proportional(2, { minWidth: 170 }), renderCell: (l) => <Text size="sm" color="secondary" maxLines={1}>{l.fit}</Text> },
    { key: "found", header: "Found", width: pixel(80), renderCell: (l) => <Text size="sm" color="secondary">{fmtDate(l.found_at)}</Text> },
  ];

  const lead = shown && all.find((l) => l.id === shown.id);
  if (lead && shown.full) {
    return (
      <div className="record-page">
        <HStack gap={2} vAlign="center" className="record-page__bar">
          <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} label="Back" clickAction={() => setShown({ ...shown, full: false })} />
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon={<X size={14} />} label="Close" clickAction={() => setShown(null)} />
        </HStack>
        <HStack gap={3} vAlign="center" className="record-page__head">
          <LeadHead l={lead} />
          <VStack gap={0.5}><Heading level={2}>{lead.org}</Heading><HStack gap={1.5}><Kind kind={lead.kind} /><Text color="secondary">{lead.name || "No person yet"}</Text></HStack></VStack>
        </HStack>
        <div className="record-page__body"><LeadBody l={lead} onLeave={() => setShown(null)} /></div>
      </div>
    );
  }

  return (
    <VStack gap={5}>
      {lead && (
        <Drawer isOpen onOpenChange={(o) => !o && setShown(null)} label={lead.org} side="end" width={520} hasScrim={false} padding={0}>
          <DrawerHeader
            title={<span className="drawer-line" title={lead.org}>{lead.org}</span>}
            subtitle={<span className="drawer-line">{lead.name ? `${lead.name}${lead.role ? ", " + lead.role : ""}` : KIND_LABEL[lead.kind] || lead.kind}</span>}
            onOpenChange={(o) => !o && setShown(null)}
            startContent={<LeadHead l={lead} />}
            endContent={<Button size="sm" variant="ghost" icon={<Maximize2 size={14} />} label="Open full page" isIconOnly tooltip="Open full page" clickAction={() => setShown({ ...shown, full: true })} />}
            hasDivider={false}
          />
          <div className="drawer-meta"><HStack gap={1.5} wrap="wrap"><Kind kind={lead.kind} /><Level rating={lead.rating} /></HStack></div>
          <div className="drawer-body"><LeadBody l={lead} onLeave={() => setShown(null)} /></div>
        </Drawer>
      )}
      <VStack gap={1}>
        <Heading level={1}>All leads</Heading>
        <Text color="secondary">Everyone your searches have found, kept here so nothing is lost. Open a lead to see who they are and why they fit, then add the ones worth writing to your pipeline, where their email is found and the first draft is written.</Text>
        <LabelsLegend />
      </VStack>

      <HStack gap={3} vAlign="center" wrap="wrap">
        <SegmentedControl label="Status" value={status} onChange={setStatus} size="sm">
          <SegmentedControlItem value="new" label={`New · ${counts.new}`} />
          <SegmentedControlItem value="pipeline" label={`In pipeline · ${counts.pipeline}`} />
          <SegmentedControlItem value="all" label={`All · ${counts.all}`} />
        </SegmentedControl>
        <div style={{ width: 170 }}><Selector label="Type" isLabelHidden value={kind} onChange={setKind}
          options={[{ value: "all", label: "All types" }, ...S.kinds.map((k) => ({ value: k, label: KIND_LABEL[k] || k }))]} /></div>
        <div style={{ width: 180 }}><Selector label="Category" isLabelHidden value={category} onChange={setCategory}
          options={[{ value: "all", label: "All categories" }, ...CATEGORIES]} /></div>
        <div style={{ width: 240 }}><TextInput label="Search leads" isLabelHidden placeholder="Search leads" value={q} onChange={setQ} startIcon={Search} hasClear /></div>
      </HStack>

      {!all.length ? (
        <EmptyState icon={<Users size={28} />} title="No leads yet" description="Run a search on Find leads. Every result is saved here." />
      ) : !list.length ? (
        <EmptyState icon={<Users size={28} />} title="No leads match" description="Try another filter or search." />
      ) : (
        <>
          <div className="table-wrap"><Table data={list} columns={columns} idKey="id" density="compact" hasHover /></div>
          <div className="actionbar">
            <HStack gap={2} vAlign="center">
              {pickable.length > 0 && <CheckboxInput label="Select all shown" isLabelHidden value={sel.length === pickable.length ? true : sel.length ? "indeterminate" : false}
                onChange={(v) => setPicked(v ? new Set(pickable.map((l) => l.id)) : new Set())} />}
              <Text size="sm">{sel.length} selected · {list.length} shown</Text>
            </HStack>
            <HStack gap={2}>
              <Button icon={<Trash2 size={16} />} label="Remove" isDisabled={!sel.length} clickAction={async () => {
                if (!confirm(`Remove ${sel.length} lead${sel.length === 1 ? "" : "s"} from this list? A new search can find them again.`)) return;
                await act("POST", "/api/leads/forget", { ids: sel }); setPicked(new Set());
              }} />
              <Button variant="primary" icon={<Plus size={16} />} label="Add to pipeline" isDisabled={!sel.length} clickAction={async () => {
                const r = await act("POST", "/api/leads/add", { rows: all.filter((l) => sel.includes(l.id)) });
                setPicked(new Set());
                toast({ body: `Added ${r.added} to your pipeline${r.skipped ? `, skipped ${r.skipped} already there` : ""}` });
              }} />
            </HStack>
          </div>
        </>
      )}
    </VStack>
  );
}
