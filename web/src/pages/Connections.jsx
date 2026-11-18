// The founder's own LinkedIn connections: upload LinkedIn's export, see who fits a data partnership or can
// introduce a target, and Add or Skip each one. Nothing here logs in to LinkedIn or sends anything.
import { useEffect, useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { TextInput } from "@astryxdesign/core/TextInput";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { ExternalLink, Search, Plus, X, Hand } from "lucide-react";
import { useApp, call } from "../data.js";

const EXPORT_PAGE = "https://www.linkedin.com/mypreferences/d/download-my-data";
// The exact path on LinkedIn, one action per step, ending at the drop box below the list.
const STEPS = [
  ["Open LinkedIn's export page", "Or on LinkedIn: your photo, Settings & Privacy, Data privacy, Get a copy of your data", true],
  ["Choose \"Want something in particular?\" and tick Connections", "Leave the other boxes empty so the file arrives faster"],
  ["Press Request archive", "LinkedIn may ask for your password"],
  ["Wait for LinkedIn's email, then press Download archive", "Usually minutes, sometimes a day or two. The link works for 72 hours"],
  ["Open the downloaded zip file", "Inside is a file named Connections.csv"],
  ["Drop Connections.csv in the box below", "It is read once and matched to your targets. Nothing is sent"],
];

const Manual = () => (
  <div className="conn-manual">
    <Hand size={16} aria-hidden="true" />
    <Text size="sm">Nothing sends itself and the app never logs in to LinkedIn. You copy the message, send it on LinkedIn, then mark it sent here.</Text>
  </div>
);

function Upload({ onDone, compact }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = async (f) => {
    setFile(f);
    if (!f || Array.isArray(f)) return;
    setBusy(true); setError("");
    try {
      const r = await call("POST", "/api/connections/import", { csv: await f.text() });
      onDone(r);
    } catch (e) { setError(e.message); }
    setBusy(false); setFile(null);
  };
  if (busy) {
    return (
      <HStack gap={3} vAlign="center" className="conn-loading">
        <Spinner label="Reading" />
        <VStack gap={0}><Text weight="medium">Reading your connections</Text><Text size="sm" color="secondary">Matching them to your data partner targets. This can take half a minute.</Text></VStack>
      </HStack>
    );
  }
  return (
    <VStack gap={2}>
      <FileInput label={compact ? "Upload a newer Connections.csv" : "Connections.csv"} isLabelHidden={!compact} mode={compact ? "input" : "dropzone"}
        accept=".csv,text/csv" value={file} onChange={read} placeholder={compact ? "Choose file" : "Drop Connections.csv here, or choose it"}
        description={compact ? "People already here are updated; your Add and Skip choices stay." : undefined} />
      {error && <Banner status="error" title={error} isDismissable onDismiss={() => setError("")} />}
    </VStack>
  );
}

function Empty({ onDone }) {
  return (
    <Card padding={5}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={2}>Connect LinkedIn</Heading>
          <Text color="secondary">The app reads a file LinkedIn gives you. It never logs in to LinkedIn and never sends anything.</Text>
        </VStack>
        <ol className="conn-steps">
          {STEPS.map(([t, s, link], i) => (
            <li key={t}><span className="conn-dot">{i + 1}</span><span><Text weight="medium">{t}</Text><Text size="sm" color="secondary">{s}</Text>
              {link && <div style={{ marginTop: 6 }}><Button icon={<ExternalLink size={16} />} label="Open LinkedIn export page" href={EXPORT_PAGE} /></div>}</span></li>
          ))}
        </ol>
        <Upload onDone={onDone} />
      </VStack>
    </Card>
  );
}

function Person({ v, busy, onSkip, onAdd, onUndo }) {
  const chip = v.kind === "intro" ? `Can introduce ${v.target?.name}` : v.kind === "direct" ? "Direct" : "";
  return (
    <Card padding={4} className="conn-card">
      <VStack gap={2}>
        <HStack gap={3} vAlign="center">
          <Avatar name={v.name} size="md" tooltip={false} />
          <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
            <Text weight="semibold">{v.name}</Text>
            <Text size="sm" color="secondary">{[v.role, v.company].filter(Boolean).join(", ")}{v.year ? ` · connected ${v.year}` : ""}</Text>
          </VStack>
        </HStack>
        <HStack gap={1.5} wrap="wrap">
          {chip && <Badge variant={v.kind === "intro" ? "purple" : "info"} label={chip} />}
          {v.decision === "skipped" && <Badge variant="neutral" label="Skipped" />}
          {(v.decision === "added" || v.in_pipeline) && <Badge variant="success" label="In pipeline" />}
        </HStack>
        {(v.why || v.known) && <Text size="sm">{[v.why, v.known].filter(Boolean).join(" ")}</Text>}
        <HStack gap={2} vAlign="center" wrap="wrap" className="conn-actions">
          <Text size="sm" color="secondary" style={{ flex: 1, minWidth: 160 }}>
            {v.kind === "intro" ? "Adds a drafted introduction ask" : "Adds a drafted first message"}
          </Text>
          {v.decision === "added" || v.in_pipeline ? null : (
            <HStack gap={2}>
              {v.decision === "skipped"
                ? <Button label="Undo skip" onClick={onUndo} isDisabled={busy} />
                : <Button icon={<X size={16} />} label="Skip" onClick={onSkip} isDisabled={busy} />}
              <Button variant="primary" icon={<Plus size={16} />} label="Add" isLoading={busy} clickAction={onAdd} />
            </HStack>
          )}
        </HStack>
      </VStack>
    </Card>
  );
}

export function Connections() {
  const { setS, toast, go } = useApp();
  const [C, setC] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [found, setFound] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState("");

  useEffect(() => { call("GET", "/api/connections").then(setC).catch((e) => setError(e.message)); }, []);

  const after = (r) => {
    if (r.connections) setC(r.connections);
    if (r.contacts) setS(r);
  };
  const imported = (r) => {
    after(r);
    const x = r.result;
    const waiting = x.waiting ? ` ${x.waiting} more possible fits are waiting to be checked.` : "";
    setNotice(`Read ${x.read} connection${x.read === 1 ? "" : "s"}: ${x.added} new, ${x.updated} updated.${waiting}`);
  };
  const skip = async (v) => {
    after(await call("POST", `/api/connections/${v.id}/skip`));
    toast({ body: `${v.name.split(" ")[0]} skipped. Still findable by search.` });
    if (found) setFound({ ...found, items: found.items.map((x) => (x.id === v.id ? { ...x, decision: "skipped" } : x)) });
  };
  const undo = async (v) => {
    after(await call("POST", `/api/connections/${v.id}/undo`));
    if (found) setFound({ ...found, items: found.items.map((x) => (x.id === v.id ? { ...x, decision: "" } : x)) });
  };
  const add = async (v) => {
    setBusyId(v.id);
    try {
      const r = await call("POST", `/api/connections/${v.id}/add`);
      after(r);
      if (found) setFound({ ...found, items: found.items.map((x) => (x.id === v.id ? { ...x, decision: "added" } : x)) });
      toast({ body: r.already ? `${v.name} is already in your pipeline.` : `${v.name.split(" ")[0]} added to Today with a drafted message. You send it yourself.` });
      if (r.warning) setNotice(r.warning);
    } catch (e) { toast({ body: e.message, type: "error" }); }
    setBusyId(null);
  };
  const search = async () => {
    if (q.trim().length < 2) return;
    setSearching(true);
    try { setFound(await call("POST", "/api/connections/search", { q })); }
    catch (e) { toast({ body: e.message, type: "error" }); }
    setSearching(false);
  };
  const checkMore = async () => {
    try { after(await call("POST", "/api/connections/classify")); }
    catch (e) { toast({ body: e.message, type: "error" }); }
  };

  const head = (
    <VStack gap={1}>
      <Heading level={1}>Connections</Heading>
      <Text color="secondary">Start with people you already know: who fits a data partnership, and who can introduce you to a target.</Text>
    </VStack>
  );
  if (!C) return <VStack gap={5}>{head}{error ? <Text color="secondary">{error}</Text> : <Spinner label="Loading" />}</VStack>;
  if (!C.total) return <VStack gap={5} className="conn-page">{head}<Manual /><Empty onDone={imported} /></VStack>;

  const shown = C.open.filter((v) => filter === "all" || v.kind === filter);
  return (
    <VStack gap={5} className="conn-page">
      {head}
      <Manual />
      {notice && <Banner status="info" title={notice} isDismissable onDismiss={() => setNotice("")} />}

      <div className="conn-meters">
        <div><span>{C.total.toLocaleString()}</span><Text size="sm" color="secondary">connections read</Text></div>
        <div><span>{C.counts.all}</span><Text size="sm" color="secondary">worth a look</Text></div>
        <div><span>{C.added}</span><Text size="sm" color="secondary">added</Text></div>
      </div>

      <form className="conn-search" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextInput label="Search your connections" isLabelHidden placeholder='e.g. "people at research labs" or "heads of community"' value={q}
            onChange={(v) => { setQ(v); if (!v) setFound(null); }} startIcon={Search} hasClear />
        </div>
        <Button type="submit" label="Search" isLoading={searching} isDisabled={q.trim().length < 2} />
      </form>

      {found ? (
        <VStack gap={3}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text size="sm" color="secondary" style={{ flex: 1 }}>
              {found.found ? `${found.found} match${found.found === 1 ? "" : "es"} across everyone you imported, skipped people included${found.found > found.items.length ? `; showing the first ${found.items.length}` : ""}.` : "Nobody matches. Try other words, a company or a name."}
            </Text>
            <Button variant="ghost" label="Clear search" onClick={() => { setQ(""); setFound(null); }} />
          </HStack>
          {found.items.map((v) => (
            <Person key={v.id} v={v} busy={busyId === v.id} onSkip={() => skip(v)} onUndo={() => undo(v)} onAdd={() => add(v)} />
          ))}
        </VStack>
      ) : (
        <VStack gap={3}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <SegmentedControl label="Show" value={filter} onChange={setFilter} size="lg">
              <SegmentedControlItem value="all" label={`All ${C.counts.all}`} />
              <SegmentedControlItem value="direct" label={`Direct ${C.counts.direct}`} />
              <SegmentedControlItem value="intro" label={`Can introduce ${C.counts.intro}`} />
            </SegmentedControl>
            <Text size="sm" color="secondary">Best known first. You decide who goes in.</Text>
          </HStack>
          {shown.length ? shown.map((v) => (
            <Person key={v.id} v={v} busy={busyId === v.id} onSkip={() => skip(v)} onUndo={() => undo(v)} onAdd={() => add(v)} />
          )) : (
            <Card padding={4} variant="muted">
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Text style={{ flex: 1 }}>{C.counts.all ? "None left in this group." : `All decided. ${C.added} added, ${C.skipped} skipped.`}</Text>
                {!C.counts.all && C.added > 0 && <Button variant="primary" label="Go to Today" onClick={() => go("today")} />}
              </HStack>
            </Card>
          )}
          {C.waiting > 0 && (
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text size="sm" color="secondary" style={{ flex: 1 }}>{C.waiting} more possible fits have not been checked yet.</Text>
              <Button label="Check more" clickAction={checkMore} />
            </HStack>
          )}
        </VStack>
      )}

      <Card padding={4} variant="muted">
        <VStack gap={2}>
          <Upload compact onDone={imported} />
          <div><Button variant="ghost" icon={<ExternalLink size={16} />} label="Open LinkedIn export page" href={EXPORT_PAGE} /></div>
        </VStack>
      </Card>
    </VStack>
  );
}
