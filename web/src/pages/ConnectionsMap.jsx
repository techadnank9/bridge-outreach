// The Connections map. A graph of thousands of people is an unreadable tangle, so this shows groups first and
// lets the founder drill in, never everything at once: You and the groups (level 0), then one group as an
// organisation chart with its organisations and the people at each (level 1), then one organisation's people
// (level 2). Every level stays under about 100 nodes. Hand-drawn with HTML and SVG lines; no chart library.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Node, MARK_LABEL } from "../Hierarchy.jsx";

const ORGS_PER_PAGE = 12;   // organisations drawn per group at once
const PEOPLE_PER_ORG = 8;   // people under each organisation in the chart
const PEOPLE_PER_PAGE = 60; // people when one organisation is opened

// One colour per group, picked to read on the dark theme and to differ from the status rings.
export const GROUP_COLOR = {
  investors: "#e9b949", leaders: "#f0845c", research: "#45c4b0", community: "#e879a6",
  builders: "#8b9cff", gtm: "#7cc8f0", other: "#8e96a3",
};

function useNarrow(px = 640) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return narrow;
}

// The route sends people as short rows; turn them into objects once.
function useGroups(map, matchIds) {
  return useMemo(() => {
    if (!map) return [];
    const f = map.person_fields;
    return map.groups.map((g) => {
      const orgs = g.orgs.map((o) => {
        const all = o.people.map((row) => Object.fromEntries(f.map((k, i) => [k, row[i]])));
        const people = matchIds ? all.filter((p) => matchIds.has(p.id)) : all;
        return { ...o, people, shownCount: matchIds ? people.length : o.count };
      }).filter((o) => o.shownCount > 0);
      return { ...g, orgs, shownCount: matchIds ? orgs.reduce((n, o) => n + o.shownCount, 0) : g.count };
    });
  }, [map, matchIds]);
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const personSub = (p) => [p.role, p.year].filter(Boolean).join(" · ");
const personTip = (p) => (p.mark === "intro" && p.via ? `Can introduce ${p.via}` : MARK_LABEL[p.mark] || "");

export function Legend() {
  return (
    <ul className="cmap-legend" aria-label="What the rings mean">
      <li><span className="hnode-dot ring-direct" aria-hidden="true" />Direct fit</li>
      <li><span className="hnode-dot ring-intro" aria-hidden="true" />Can introduce someone</li>
      <li><span className="hnode-dot ring-pipeline" aria-hidden="true" />In your pipeline</li>
    </ul>
  );
}

// Level 0 on wide screens: You in the centre, groups around it, sized by headcount.
function Radial({ groups, total, onOpen, searching }) {
  const max = Math.max(...groups.map((g) => g.count), 1);
  const n = groups.length;
  const spots = groups.map((g, i) => {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    return { g, x: 50 + 36 * Math.cos(a), y: 47 + 35 * Math.sin(a), d: Math.round(60 + 70 * Math.sqrt(g.count / max)) };
  });
  return (
    <div className="cmap-radial">
      <svg className="cmap-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {spots.map(({ g, x, y }) => (
          <line key={g.key} x1="50" y1="47" x2={x} y2={y} style={{ stroke: GROUP_COLOR[g.key] }}
            className={searching && !g.shownCount ? "is-dim" : ""} strokeWidth={1 + 2.5 * (g.count / max)} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="cmap-you" style={{ left: "50%", top: "47%" }}>
        <span className="cmap-you-dot">You</span>
        <span className="cmap-you-sub">{plural(total, "connection")}</span>
      </div>
      {spots.map(({ g, x, y, d }, i) => (
        <button key={g.key} type="button" className={`cmap-bubble ${searching && !g.shownCount ? "is-dim" : ""}`}
          style={{ left: `${x}%`, top: `${y}%`, "--d": `${d}px`, "--c": GROUP_COLOR[g.key], "--i": i }}
          onClick={() => onOpen(g.key)} disabled={searching && !g.shownCount}
          aria-label={`${g.name}: ${searching ? plural(g.shownCount, "match", "matches") : plural(g.count, "person", "people")}. Open`}>
          <span className="cmap-bubble-disc"><span>{(searching ? g.shownCount : g.count).toLocaleString()}</span></span>
          <span className="cmap-bubble-name">{g.name}</span>
          <span className="cmap-bubble-sub">{searching ? plural(g.shownCount, "match", "matches") : g.marked ? `${g.marked} worth a look` : plural(g.orgs.length, "organisation")}</span>
        </button>
      ))}
    </div>
  );
}

// Level 0 on phones: the same groups as a short tree under You, biggest first.
function GroupTree({ groups, total, onOpen, searching }) {
  const max = Math.max(...groups.map((g) => g.count), 1);
  // "Everyone else" is the leftover, so it always comes last whatever its size.
  const sorted = [...groups].sort((a, b) => (a.key === "other") - (b.key === "other") || b.shownCount - a.shownCount || b.count - a.count);
  return (
    <ul className="tree cmap-tree">
      <li>
        <Node tone="you" name="You" sub={plural(total, "connection")} />
        <ul>
          {sorted.map((g) => (
            <li key={g.key}>
              <button type="button" className={`cmap-row ${searching && !g.shownCount ? "is-dim" : ""}`} onClick={() => onOpen(g.key)}
                disabled={searching && !g.shownCount} style={{ "--c": GROUP_COLOR[g.key] }}>
                <span className="cmap-row-disc" style={{ "--s": `${Math.round(28 + 16 * Math.sqrt(g.count / max))}px` }} aria-hidden="true" />
                <span className="hnode-text">
                  <span className="hnode-name">{g.name}</span>
                  <span className="hnode-sub">{searching ? plural(g.shownCount, "match", "matches") : `${plural(g.count, "person", "people")}${g.marked ? ` · ${g.marked} worth a look` : ""}`}</span>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </li>
    </ul>
  );
}

function PersonNode({ p, onPick, selectedId }) {
  return <Node name={p.name} sub={personSub(p)} mark={p.mark === "skipped" ? "" : p.mark} onClick={() => onPick(p.id)} isSelected={selectedId === p.id}
    tone={p.mark === "skipped" ? "muted" : ""} title={personTip(p)} />;
}

function OrgHead({ o, onOpen }) {
  return (
    <button type="button" className="cmap-org-head" onClick={onOpen} aria-label={`${o.name}: ${plural(o.shownCount, "person", "people")}. Open everyone here`}>
      <span className="cmap-org-name">{o.name}</span>
      <span className="cmap-org-sub">{plural(o.shownCount, "person", "people")}{o.marked ? ` · ${o.marked} worth a look` : ""}</span>
    </button>
  );
}

function People({ o, onPick, selectedId, onMore }) {
  const shown = o.people.slice(0, PEOPLE_PER_ORG);
  return (
    <ul>
      {shown.map((p) => <li key={p.id}><PersonNode p={p} onPick={onPick} selectedId={selectedId} /></li>)}
      {o.people.length > shown.length && (
        <li><button type="button" className="hnode hnode-more" onClick={onMore}>+{o.people.length - shown.length} more</button></li>
      )}
    </ul>
  );
}

// Level 1 on wide screens: the group at the top, its organisations as branches in a grid, people as leaves.
// The connector lines are measured from the laid-out cards, so they stay right at any width.
function OrgChart({ g, orgs, onPick, selectedId, onOrg }) {
  const wrap = useRef(null), root = useRef(null), cards = useRef([]);
  const [paths, setPaths] = useState([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const r = root.current.getBoundingClientRect();
      const rx = r.left + r.width / 2 - base.left, ry = r.bottom - base.top;
      const rects = cards.current.slice(0, orgs.length).filter(Boolean).map((c) => c.getBoundingClientRect());
      if (!rects.length) return setPaths((prev) => (prev.length ? [] : prev));
      const rows = [...new Set(rects.map((c) => Math.round(c.top)))].sort((a, b) => a - b);
      const firstRow = rects.filter((c) => Math.round(c.top) === rows[0]);
      // Later rows are reached through the gap between first-row cards nearest the centre, so lines never cross a card.
      let gapX = rx;
      if (rows.length > 1 && firstRow.length > 1) {
        const gaps = firstRow.slice(1).map((c, i) => (firstRow[i].right + c.left) / 2 - base.left);
        gapX = gaps.reduce((best, x) => (Math.abs(x - rx) < Math.abs(best - rx) ? x : best), gaps[0]);
      }
      const bus = (top) => top - base.top - 14;
      const next = rects.map((c) => {
        const row = rows.indexOf(Math.round(c.top));
        const cx = c.left + c.width / 2 - base.left, top = c.top - base.top;
        return row === 0
          ? `M${rx} ${ry} V${bus(c.top)} H${cx} V${top}`
          : `M${rx} ${ry} V${bus(rows[0])} H${gapX} V${bus(c.top)} H${cx} V${top}`;
      });
      // Only update when something moved, so drawing never triggers another render loop.
      setPaths((prev) => (prev.join("|") === next.join("|") ? prev : next));
      setBox((prev) => (prev.w === base.width && prev.h === base.height ? prev : { w: base.width, h: base.height }));
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [orgs, g.key]);
  return (
    <div className="cmap-chart" ref={wrap}>
      <svg className="cmap-chart-lines" width={box.w} height={box.h} aria-hidden="true">
        {paths.map((d, i) => <path key={i} d={d} style={{ stroke: GROUP_COLOR[g.key] }} />)}
      </svg>
      <div className="cmap-root" ref={root} style={{ "--c": GROUP_COLOR[g.key] }}>
        <span className="cmap-root-disc" aria-hidden="true" />
        <span className="hnode-text"><span className="hnode-name">{g.name}</span><span className="hnode-sub">{plural(g.shownCount, "person", "people")} at {plural(g.orgs.length, "organisation")}</span></span>
      </div>
      <div className="cmap-orgs">
        {orgs.map((o, i) => (
          <div key={o.name} className="cmap-org" ref={(el) => (cards.current[i] = el)} style={{ "--i": i }}>
            <OrgHead o={o} onOpen={() => onOrg(o.name)} />
            <div className="tree cmap-leaves"><People o={o} onPick={onPick} selectedId={selectedId} onMore={() => onOrg(o.name)} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Level 1 on phones: the same chart as an indented tree with connector lines.
function OrgTree({ g, orgs, onPick, selectedId, onOrg }) {
  return (
    <ul className="tree cmap-tree">
      <li>
        <div className="cmap-root" style={{ "--c": GROUP_COLOR[g.key] }}>
          <span className="cmap-root-disc" aria-hidden="true" />
          <span className="hnode-text"><span className="hnode-name">{g.name}</span><span className="hnode-sub">{plural(g.shownCount, "person", "people")}</span></span>
        </div>
        <ul>
          {orgs.map((o) => (
            <li key={o.name}>
              <OrgHead o={o} onOpen={() => onOrg(o.name)} />
              <People o={o} onPick={onPick} selectedId={selectedId} onMore={() => onOrg(o.name)} />
            </li>
          ))}
        </ul>
      </li>
    </ul>
  );
}

// Level 2: everyone the founder knows at one organisation, a page at a time.
function OrgPeople({ g, o, onPick, selectedId }) {
  const [page, setPage] = useState(0);
  const people = o.people.slice(page * PEOPLE_PER_PAGE, (page + 1) * PEOPLE_PER_PAGE);
  return (
    <ul className="tree cmap-tree">
      <li>
        <div className="cmap-root" style={{ "--c": GROUP_COLOR[g.key] }}>
          <span className="cmap-root-disc" aria-hidden="true" />
          <span className="hnode-text"><span className="hnode-name">{o.name}</span><span className="hnode-sub">{plural(o.people.length, "person", "people")} you know here</span></span>
        </div>
        <ul className="cmap-people-grid">
          {people.map((p) => <li key={p.id}><PersonNode p={p} onPick={onPick} selectedId={selectedId} /></li>)}
        </ul>
        {o.people.length > PEOPLE_PER_PAGE && (
          <div className="cmap-pager">
            <Text size="sm" color="secondary">{page * PEOPLE_PER_PAGE + 1} to {Math.min(o.people.length, (page + 1) * PEOPLE_PER_PAGE)} of {o.people.length}</Text>
            {page > 0 && <Button label="Previous" onClick={() => setPage(page - 1)} />}
            {(page + 1) * PEOPLE_PER_PAGE < o.people.length && <Button label="Next people" onClick={() => setPage(page + 1)} />}
          </div>
        )}
      </li>
    </ul>
  );
}

export function ConnectionsMap({ map, matchIds, onPick, selectedId }) {
  const narrow = useNarrow();
  const groups = useGroups(map, matchIds);
  const [at, setAt] = useState({ group: null, org: null, page: 0 });
  const backRef = useRef(null);
  const g = groups.find((x) => x.key === at.group);
  const o = g && at.org != null ? g.orgs.find((x) => x.name === at.org) : null;
  // A search that leaves the open group or organisation empty goes back up a level instead of showing nothing.
  useEffect(() => {
    if (at.group && !g) setAt({ group: null, org: null, page: 0 });
    else if (at.org != null && g && !o) setAt({ ...at, org: null, page: 0 });
  }, [g, o, at]);
  const goTo = (next) => { setAt(next); requestAnimationFrame(() => backRef.current?.focus()); };
  const up = () => setAt(at.org != null ? { ...at, org: null } : { group: null, org: null, page: 0 });
  useEffect(() => {
    if (!at.group) return;
    const key = (e) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) up(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!map) return null;
  const searching = Boolean(matchIds);
  const visible = groups.filter((x) => x.count > 0);
  const pages = g ? Math.ceil(g.orgs.length / ORGS_PER_PAGE) : 0;
  const orgs = g ? g.orgs.slice(at.page * ORGS_PER_PAGE, (at.page + 1) * ORGS_PER_PAGE) : [];

  return (
    <div className="cmap" data-level={o ? 2 : g ? 1 : 0}>
      <div className="cmap-bar">
        <nav aria-label="Where you are on the map" className="cmap-crumbs">
          <ol>
            <li>{g ? <button type="button" onClick={() => setAt({ group: null, org: null, page: 0 })}>You</button> : <span aria-current="page">You</span>}</li>
            {g && <li><ChevronRight size={14} aria-hidden="true" />{o ? <button type="button" onClick={() => setAt({ ...at, org: null })}>{g.name}</button> : <span aria-current="page">{g.name}</span>}</li>}
            {o && <li><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{o.name}</span></li>}
          </ol>
        </nav>
        {g && <span ref={backRef} tabIndex={-1} className="cmap-back"><Button icon={<ArrowLeft size={16} />} label={o ? `Back to ${g.name}` : "Back to all groups"} onClick={up} /></span>}
      </div>

      <div className="cmap-stage" key={`${at.group}|${at.org}|${at.page}`}>
        {!g ? (
          narrow
            ? <GroupTree groups={visible} total={map.total} onOpen={(k) => goTo({ group: k, org: null, page: 0 })} searching={searching} />
            : <Radial groups={visible} total={map.total} onOpen={(k) => goTo({ group: k, org: null, page: 0 })} searching={searching} />
        ) : o ? (
          <OrgPeople g={g} o={o} onPick={onPick} selectedId={selectedId} />
        ) : narrow ? (
          <OrgTree g={g} orgs={orgs} onPick={onPick} selectedId={selectedId} onOrg={(name) => goTo({ ...at, org: name })} />
        ) : (
          <OrgChart g={g} orgs={orgs} onPick={onPick} selectedId={selectedId} onOrg={(name) => goTo({ ...at, org: name })} />
        )}
      </div>

      {g && !o && pages > 1 && (
        <div className="cmap-pager">
          <Text size="sm" color="secondary">Organisations {at.page * ORGS_PER_PAGE + 1} to {Math.min(g.orgs.length, (at.page + 1) * ORGS_PER_PAGE)} of {g.orgs.length}</Text>
          {at.page > 0 && <Button label="Previous organisations" onClick={() => setAt({ ...at, page: at.page - 1 })} />}
          {at.page + 1 < pages && <Button label={`+${g.orgs.length - (at.page + 1) * ORGS_PER_PAGE} more organisations`} onClick={() => setAt({ ...at, page: at.page + 1 })} />}
        </div>
      )}
      <div className="cmap-foot">
        <Legend />
        <Text size="sm" color="secondary">{g ? "Pick a person to see why they matter and to Add or Skip them." : "Pick a group to see its organisations and people."}</Text>
      </div>
    </div>
  );
}
