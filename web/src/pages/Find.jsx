import { useEffect, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Sparkles, SearchX, Plus, Eraser } from "lucide-react";
import { useApp, call, fmtDate, inPipeline, safeUrl } from "../data.js";
import { Kind } from "../bits.jsx";

const DEFAULTS = {
  investor: { query: "AI meeting facilitation, group collaboration and collective intelligence software", count: "5", early: true },
  partner: { keywords: "community platform, leadership development, facilitation", titles: "Partnerships, Community, Head of People" },
  conference: { keywords: "conference, summit, events", titles: "Program Director, Head of Events, Organizer" },
  community: { keywords: "community, nonprofit, NGO, association, network, foundation, membership", titles: "Founder, Executive Director, Head of Community, Community Manager, Organizer, President" },
};
const TABS = [["investor", "Investors"], ["partner", "Partners"], ["conference", "Conferences"], ["community", "Communities"]];
const LABEL = { investor: "investors", partner: "partners", conference: "conference contacts", community: "community leaders" };
const money = (n) => "$" + Number(n).toFixed(2);

// Form values per tab survive switching tabs and leaving the page.
const memory = { tab: "investor", form: structuredClone(DEFAULTS), plain: "" };

export function Find() {
  const { S, setS, act, toast, go } = useApp();
  const [tab, setTab] = useState(memory.tab);
  const [form, setForm] = useState(memory.form);
  const [plain, setPlain] = useState(memory.plain);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(null);
  const [picked, setPicked] = useState(new Set());

  useEffect(() => { memory.tab = tab; memory.form = form; memory.plain = plain; }, [tab, form, plain]);
  useEffect(() => {
    if (S.leads.enabled) call("GET", "/api/leads/balance").then((r) => r.available !== null && setBalance(Number(r.available))).catch(() => {});
  }, [S.leads.enabled]);

  const saved = (S.leadResults || {})[tab];
  const rows = saved ? saved.rows : [];
  // A new set of saved results starts with every new person ticked.
  useEffect(() => { setPicked(new Set(rows.map((r, i) => (inPipeline(S, r) ? -1 : i)).filter((i) => i >= 0))); }, [tab, saved?.at, S.contacts.length]);

  if (!S.leads.enabled) {
    return (
      <VStack gap={4}>
        <Heading level={1}>Find leads</Heading>
        <EmptyState icon={<SearchX size={28} />} title="Lead finding is not set up on this machine" description="It needs the Glasser tool installed and signed in." />
      </VStack>
    );
  }

  const f = form[tab];
  const set = (patch) => setForm({ ...form, [tab]: { ...f, ...patch } });
  const p = S.leads;
  const cost = tab === "investor" ? Number(f.count) * p.pricePerFirm + p.pricePerLookup : p.pricePerLookup;

  const fillFromWords = async () => {
    try {
      const { plan } = await call("POST", "/api/leads/plan", { text: plain });
      const next = { ...form };
      if (plan.kind === "investor") next.investor = { ...form.investor, query: plan.query || form.investor.query };
      else next[plan.kind] = { keywords: (plan.keywords || []).join(", "), titles: (plan.titles || []).join(", ") };
      setForm(next); setTab(plan.kind);
      setNote(`${plan.note} Check the fields, then run the search.`);
    } catch (e) { setNote(e.message); }
  };

  const run = async () => {
    setBusy(true); setNote("");
    try {
      const body = tab === "investor" ? { query: f.query, count: Number(f.count), earlyOnly: f.early } : { kind: tab, keywords: f.keywords, titles: f.titles };
      const r = await call("POST", tab === "investor" ? "/api/leads/investors" : "/api/leads/people", body);
      setS((prev) => ({ ...prev, leadResults: r.leadResults || prev.leadResults, allLeads: r.allLeads || prev.allLeads }));
      if (r.warning) setNote(r.warning);
      else if (!r.rows.length) setNote("Nothing matched, so nothing was charged. Try broader wording.");
      if (r.rows.length) toast({ body: `Found ${r.rows.length}. Charged ${money(r.charge)}.` });
      call("GET", "/api/leads/balance").then((b) => b.available !== null && setBalance(Number(b.available))).catch(() => {});
    } catch (e) { setNote(e.message); }
    setBusy(false);
  };

  const add = async () => {
    const r = await act("POST", "/api/leads/add", { rows: rows.filter((_, i) => picked.has(i)) });
    toast({ body: `Added ${r.added} to your pipeline${r.skipped ? `, skipped ${r.skipped} already there` : ""}. Strong leads are being researched and drafted.` });
  };

  const fresh = rows.filter((r) => !inPipeline(S, r));
  const columns = [
    { key: "pick", header: "", width: pixel(48), renderCell: (r) => {
      const i = rows.indexOf(r);
      return inPipeline(S, r) ? <Text color="secondary" size="sm">✓</Text> : (
        <CheckboxInput label={`Select ${r.name || r.org}`} isLabelHidden value={picked.has(i)}
          onChange={(v) => { const n = new Set(picked); v ? n.add(i) : n.delete(i); setPicked(n); }} />
      );
    } },
    { key: "org", header: "Organisation", width: proportional(1.5, { minWidth: 160 }), renderCell: (r) => <Text weight="medium">{r.org}</Text> },
    { key: "name", header: "Person", width: proportional(1.2, { minWidth: 130 }), renderCell: (r) => r.name ? <Text>{r.name}</Text> : <Text color="secondary" size="sm">No person found</Text> },
    { key: "role", header: "Role", width: proportional(1.2, { minWidth: 120 }), renderCell: (r) => <Text size="sm" color="secondary">{r.role}</Text> },
    { key: "links", header: "Links", width: pixel(110), renderCell: (r) => (
      <HStack gap={1}>{safeUrl(r.linkedin) && <Button size="sm" variant="ghost" label="LinkedIn" href={safeUrl(r.linkedin)} />}</HStack>
    ) },
    { key: "email", header: "Email", width: pixel(100), renderCell: (r) => r.name ? <Text size="sm" color={r.email_available ? "accent" : "secondary"}>{r.email_available ? "Available" : "Not listed"}</Text> : null },
    { key: "fit", header: "Why they fit", width: proportional(2, { minWidth: 180 }), renderCell: (r) => <Text size="sm" color="secondary" maxLines={2}>{r.fit}</Text> },
  ];

  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={1}>Find leads</Heading>
        <Text color="secondary">Search for people to reach, with their role and LinkedIn profile. Each search shows its price before it runs.{balance !== null ? ` Balance: ${money(balance)}.` : ""}</Text>
      </VStack>

      <Card padding={4} className="plain-card">
        <VStack gap={2}>
          <HStack gap={2} vAlign="end">
            <div style={{ flex: 1 }}>
              <TextInput label="Describe who you want to reach" placeholder="e.g. heads of community at professional networks for women in tech" value={plain} onChange={setPlain} startIcon={Sparkles} onEnter={fillFromWords} />
            </div>
            <Button label="Fill in the search" clickAction={fillFromWords} isDisabled={plain.trim().length < 6} />
          </HStack>
          <Text size="sm" color="secondary">Turns your words into the search below. Nothing is charged until you run the search.</Text>
        </VStack>
      </Card>

      <TabList value={tab} onChange={(v) => { setTab(v); setNote(""); }}>
        {TABS.map(([id, name]) => <Tab key={id} value={id} label={name} />)}
      </TabList>

      {note && <Banner status="info" title={note} isDismissable onDismiss={() => setNote("")} />}

      <Card padding={4}>
        <VStack gap={3}>
          {tab === "investor" ? (
            <>
              <TextArea label="What does your company do?" value={f.query} onChange={(v) => set({ query: v })} rows={2}
                description="Finds firms that funded similar companies in the last two years, then up to two partners at each." />
              <HStack gap={4} vAlign="center" wrap="wrap">
                <div style={{ width: 160 }}><Selector label="How many firms" options={["5", "10", "20"]} value={String(f.count)} onChange={(v) => set({ count: v })} /></div>
                <Switch label="Early-stage rounds only" value={f.early} onChange={(v) => set({ early: v })} />
              </HStack>
            </>
          ) : (
            <>
              <TextInput label={tab === "partner" ? "Kind of organisation" : tab === "community" ? "Kind of community" : "Kind of event"} value={f.keywords} onChange={(v) => set({ keywords: v })} description="Keywords, separated by commas." />
              <TextInput label="Roles to reach" value={f.titles} onChange={(v) => set({ titles: v })} description="One person per organisation, up to 25 results." />
            </>
          )}
          <HStack><Button variant="primary" isLoading={busy} label={`Find ${LABEL[tab]} · about ${money(cost)}`} onClick={run} /></HStack>
        </VStack>
      </Card>

      {rows.length > 0 && (
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text size="sm" color="secondary" style={{ flex: 1 }}>
              Last search{saved?.at ? ` · ${fmtDate(saved.at)} ${new Date(saved.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""} · {rows.length} results, {rows.length - fresh.length} in pipeline
            </Text>
            <Button size="sm" variant="ghost" icon={<Eraser size={14} />} label="Clear results" clickAction={async () => {
              if (!confirm("Clear these search results? Leads already added to your pipeline stay there.")) return;
              await act("POST", "/api/leads/clear", { kind: tab });
            }} />
          </HStack>
          <div className="table-wrap"><Table data={rows} columns={columns} density="compact" /></div>
          <div className="actionbar">
            <Text size="sm">{picked.size} of {fresh.length} new selected</Text>
            <HStack gap={2}>
              <Button label="See all leads" onClick={() => go("leads")} />
              <Button variant="primary" icon={<Plus size={16} />} label="Add to pipeline" isDisabled={!picked.size} clickAction={add} />
            </HStack>
          </div>
        </VStack>
      )}
    </VStack>
  );
}
