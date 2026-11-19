// "How you know them": a small tree from the founder to a person, through their organisation, with the other
// people the founder knows there as siblings. Used on a lead's profile (Record.jsx) and on the person card of
// the Connections map. Data comes from GET /api/connections/around/:contactId or GET /api/connections/:id.
import { Text } from "@astryxdesign/core/Text";

export const MARK_LABEL = { direct: "Direct fit", intro: "Can introduce someone", pipeline: "In your pipeline" };

const initials = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// One node: a round mark (initials, ringed by its status) and a name with one line under it.
export function Node({ name, sub, tone = "", mark = "", onClick, isSelected, title: tip }) {
  const body = (
    <>
      <span className={`hnode-dot ${mark ? `ring-${mark}` : ""}`} aria-hidden="true">{tone === "you" ? "You" : initials(name)}</span>
      <span className="hnode-text">
        <span className="hnode-name">{tone === "you" ? "You" : name}</span>
        {sub && <span className="hnode-sub">{sub}</span>}
      </span>
    </>
  );
  const cls = `hnode ${tone ? `hnode-${tone}` : ""} ${isSelected ? "is-selected" : ""}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={isSelected || undefined} title={tip}>{body}</button>
    : <span className={cls} title={tip}>{body}</span>;
}

const year = (y) => (y ? `connected ${y}` : "connected on LinkedIn");

export function HowYouKnow({ data, onPick, heading = true }) {
  if (!data || data.empty) return null;
  const { mode, person, target, org, others = [], more = 0 } = data;
  const sibling = (o) => (
    <li key={o.id}>
      <Node name={o.name} sub={[o.role, o.year].filter(Boolean).join(" · ")} mark={o.mark} onClick={onPick ? () => onPick(o.id) : undefined} />
    </li>
  );
  const targetNode = target && (
    <Node name={target.name} sub={mode === "org" ? `${target.role ? `${target.role} · ` : ""}reachable through them` : `${target.role ? `${target.role} · ` : ""}they can introduce you`} tone="target" />
  );
  const personNode = person && (
    <li>
      <Node name={person.name} sub={[person.role, year(person.year)].filter(Boolean).join(" · ")} tone="focus" />
      {target && <ul><li>{targetNode}</li></ul>}
    </li>
  );
  const hasOrg = org && org.name && (others.length || mode === "org");
  return (
    <div className="hyk">
      {heading && <Text size="sm" weight="semibold">How you know them</Text>}
      <ul className="tree hyk-tree" aria-label="How you know them">
        <li>
          <Node tone="you" name="You" />
          <ul>
            {hasOrg ? (
              <li>
                <Node name={org.name} sub={`you know ${org.known} ${org.known === 1 ? "person" : "people"} here`} tone="org" />
                <ul>
                  {personNode}
                  {others.map(sibling)}
                  {more > 0 && <li><span className="hnode hnode-more">+{more} more at {org.name}</span></li>}
                  {mode === "org" && <li>{targetNode}</li>}
                </ul>
              </li>
            ) : personNode}
          </ul>
        </li>
      </ul>
    </div>
  );
}
