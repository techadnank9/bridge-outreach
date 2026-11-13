import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { Icon } from "@astryxdesign/core/Icon";
import { Badge } from "@astryxdesign/core/Badge";
import { Divider } from "@astryxdesign/core/Divider";
import { Center } from "@astryxdesign/core/Center";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { useToast } from "@astryxdesign/core/Toast";
import {
  Sunrise, KanbanSquare, Search, Users, Reply, LineChart, Upload, PenLine, LogOut, Orbit,
} from "lucide-react";
import { AppContext, call, followups, reviewQueue, todayActions } from "./data.js";
import { Today } from "./pages/Today.jsx";
import { Pipeline } from "./pages/Pipeline.jsx";
import { Find } from "./pages/Find.jsx";
import { Leads } from "./pages/Leads.jsx";
import { Followups } from "./pages/Followups.jsx";
import { Insights } from "./pages/Insights.jsx";
import { Import } from "./pages/Import.jsx";
import { Pitch } from "./pages/Pitch.jsx";
import { Record } from "./Record.jsx";

const PAGES = { today: Today, pipeline: Pipeline, find: Find, leads: Leads, followups: Followups, insights: Insights, import: Import, settings: Pitch };

export function App() {
  const [S, setS] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState(() => (location.hash.slice(1) in PAGES ? location.hash.slice(1) : "today"));
  const [opened, setOpened] = useState(null);
  const toast = useToast();

  const refresh = useCallback(async () => setS(await call("GET", "/api/state")), []);
  // Every action returns fresh state; one helper keeps the page in sync and reports failures.
  const act = useCallback(async (method, url, body) => {
    try {
      const data = await call(method, url, body);
      if (data.contacts) setS(data);
      return data;
    } catch (e) {
      if (e.state) setS(e.state);
      toast({ body: e.message, type: "error" });
      throw e;
    }
  }, [toast]);

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);
  // Background work (research, drafts, Gmail checks) lands on the server; pick it up every half minute.
  useEffect(() => { const t = setInterval(() => refresh().catch(() => {}), 30_000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { location.hash = view; }, [view]);

  const go = (next) => { setOpened(null); setView(next); };
  const open = useCallback((id, tab = "outreach") => setOpened({ id, tab }), []);
  const ctx = useMemo(() => ({ S, setS, act, refresh, toast, go, open, openId: opened?.id }), [S, act, refresh, toast, open, opened]);

  if (!S) {
    return <Center height="100vh">{error ? <Text color="secondary">{error}</Text> : <Spinner label="Loading" />}</Center>;
  }

  const counts = {
    today: reviewQueue(S).length + todayActions(S).length,
    pipeline: S.contacts.length,
    leads: (S.allLeads || []).filter((l) => !S.contacts.some((c) => (c.org || "").toLowerCase() === (l.org || "").toLowerCase() && (c.name || "").toLowerCase() === (l.name || "").toLowerCase())).length,
    followups: followups(S).length,
  };
  const nav = [
    ["today", "Today", Sunrise],
    ["pipeline", "Pipeline", KanbanSquare],
    ["find", "Find leads", Search],
    ["leads", "All leads", Users],
    ["followups", "Follow-ups", Reply],
    ["insights", "What works", LineChart],
    ["import", "Import", Upload],
    ["settings", "Your pitch", PenLine],
  ];
  const Page = PAGES[view];

  return (
    <AppContext.Provider value={ctx}>
      <AppShell
        contentPadding={0}
        sideNav={
          <SideNav
            collapsible
            header={
              <SideNavHeading
                heading="Bridge Outreach"
                subheading="Investors, partners, conferences, communities"
                icon={<NavIcon icon={<Icon icon={Orbit} size="sm" />} />}
              />
            }
            footer={
              <SideNavSection title="Status" isHeaderHidden>
                <div className="nav-status">
                  <StatusDot variant={S.ai ? "success" : "neutral"} label={S.ai ? "AI drafts on" : "Template drafts"} />
                  <Text size="xsm" color="secondary">{S.ai ? `Drafts by ${S.aiModel}` : "Add an API key for AI drafts"}</Text>
                  <StatusDot variant={S.gmail.connected ? "success" : "warning"} label={S.gmail.connected ? "Gmail connected" : "Gmail not connected"} />
                  <Text size="xsm" color="secondary">{S.gmail.connected ? S.gmail.address : "Connect it on Your pitch to send"}</Text>
                </div>
                {S.auth && <SideNavItem label="Sign out" icon={LogOut} href="/logout" />}
              </SideNavSection>
            }>
            <SideNavSection title="Work" isHeaderHidden>
              {nav.slice(0, 5).map(([id, label, icon]) => (
                <SideNavItem key={id} label={label} icon={icon} isSelected={view === id} onClick={() => go(id)}
                  endContent={counts[id] ? <Badge label={String(counts[id])} variant={id === "today" ? "info" : "neutral"} /> : undefined} />
              ))}
            </SideNavSection>
            <Divider />
            <SideNavSection title="Setup" isHeaderHidden>
              {nav.slice(5).map(([id, label, icon]) => (
                <SideNavItem key={id} label={label} icon={icon} isSelected={view === id} onClick={() => go(id)} />
              ))}
            </SideNavSection>
          </SideNav>
        }>
        <div className="page">
          <Page />
        </div>
      </AppShell>
      {opened && <Record id={opened.id} tab={opened.tab} onClose={() => setOpened(null)} />}
    </AppContext.Provider>
  );
}
