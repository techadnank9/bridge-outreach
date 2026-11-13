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
import { Users, Plus, Trash2, Search } from "lucide-react";
import { useApp, inPipeline, fmtDate, safeUrl, KIND_LABEL } from "../data.js";
import { Grade, Kind, Level, DreamStar } from "../bits.jsx";

const CATEGORIES = ["Decision maker", "Influencer", "Contact", "Firm only"];

export function Leads() {
  const { S, act, toast } = useApp();
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
    { key: "score", header: "Score", width: pixel(170), renderCell: (l) => <HStack gap={1.5} vAlign="center"><Grade rating={l.rating} /><Level rating={l.rating} /></HStack> },
    { key: "org", header: "Organisation", width: proportional(1.4, { minWidth: 150 }), renderCell: (l) => (
      <VStack gap={0}><Text weight="medium">{l.org}</Text>{safeUrl(l.website) && <a className="sub-link" href={safeUrl(l.website)} target="_blank" rel="noopener">Website</a>}</VStack>
    ) },
    { key: "name", header: "Person", width: proportional(1.2, { minWidth: 130 }), renderCell: (l) => (
      <VStack gap={0}>{l.name ? <Text>{l.name}</Text> : <Text color="secondary" size="sm">No person found</Text>}<Text size="sm" color="secondary">{l.role}</Text></VStack>
    ) },
    { key: "category", header: "Category", width: pixel(130), renderCell: (l) => <Text size="sm" color="secondary">{l.rating?.category}</Text> },
    { key: "kind", header: "Type", width: pixel(120), renderCell: (l) => <Kind kind={l.kind} /> },
    { key: "fit", header: "Why they fit", width: proportional(2, { minWidth: 170 }), renderCell: (l) => <Text size="sm" color="secondary" maxLines={2}>{l.fit}</Text> },
    { key: "found", header: "Found", width: pixel(80), renderCell: (l) => <Text size="sm" color="secondary">{fmtDate(l.found_at)}</Text> },
  ];

  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={1}>All leads</Heading>
        <Text color="secondary">Every lead your searches have found, kept in one place. Nothing is charged again to see them. Star the ones you most want; dream and strong leads are researched and drafted for you when you add them.</Text>
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
