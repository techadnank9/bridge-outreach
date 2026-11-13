// Small pieces shared by every page: score grade, tier, lead type, stage, the dream star.
import { Badge } from "@astryxdesign/core/Badge";
import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Star } from "lucide-react";
import { KIND_COLOR, LEVEL_COLOR, STAGE_COLOR, safeUrl, sources } from "./data.js";

// What each tier means and what the app does with it. Shown on hover and in the legend.
export const LEVEL_HELP = {
  1: { name: "★ Dream", text: "Your top targets: scored 85 or more, or starred by you. Researched, given a reason to write now, and drafted automatically." },
  2: { name: "Strong", text: "Scored 70 to 84. Good fit with enough to go on. Researched and drafted automatically when added to the pipeline." },
  3: { name: "Fit", text: "Scored 45 to 69. Worth writing to, but nothing runs automatically. Open it and write when you are ready." },
  4: { name: "Not now", text: "Scored under 45, usually missing a person, a way to reach them, or a clear reason they fit. Kept, but not worked on." },
};
export const HEAT_HELP = "Score out of 100: Hot is 70 or more, Warm 45 to 69, Cold under 45. Points come from who the person is (decision maker, influencer), how to reach them (LinkedIn, email), and why to write (a clear fit, a recent reason, a warm introduction).";

export function Grade({ rating }) {
  if (!rating) return null;
  const heat = { Hot: "orange", Warm: "yellow", Cold: "gray" }[rating.tier];
  const tip = (
    <div className="tip">
      <div className="tip-title">{rating.score} out of 100 · {rating.tier}</div>
      <ul className="tip-list">{rating.why.map((w) => <li key={w}>{w}</li>)}</ul>
      <div className="tip-foot">Hot is 70 or more, Warm 45 to 69, Cold under 45.</div>
    </div>
  );
  return (
    <Tooltip content={tip}>
      <span className="grade" tabIndex={0}>
        <span className="grade-num">{rating.score}</span>
        <Text size="sm" color="secondary" as="span">{rating.tier}</Text>
        <span className={`heat heat-${heat}`} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

export function Level({ rating }) {
  if (!rating?.level) return null;
  const help = LEVEL_HELP[rating.level];
  return (
    <Tooltip content={<div className="tip"><div className="tip-title">{help.name}</div><div>{help.text}</div></div>}>
      <span tabIndex={0} className="level-wrap"><Badge variant={LEVEL_COLOR[rating.level]} label={rating.level === 1 ? "★ Dream" : rating.levelName} /></span>
    </Tooltip>
  );
}

// "What do the labels mean?": every tier and the score, in one place on Pipeline and All leads.
export function LabelsLegend() {
  return (
    <details className="legend">
      <summary>What do the labels mean?</summary>
      <div className="legend-body">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="legend-row">
            <span className="legend-badge"><Badge variant={LEVEL_COLOR[n]} label={LEVEL_HELP[n].name} /></span>
            <Text size="sm">{LEVEL_HELP[n].text}</Text>
          </div>
        ))}
        <div className="legend-row">
          <span className="legend-badge"><span className="grade"><span className="grade-num">72</span><Text size="sm" color="secondary" as="span">Hot</Text><span className="heat heat-orange" aria-hidden="true" /></span></span>
          <Text size="sm">{HEAT_HELP} Hover any score to see exactly how it was added up.</Text>
        </div>
        <div className="legend-row">
          <span className="legend-badge"><Star size={16} className="legend-star" /></span>
          <Text size="sm">Click the star on any lead to make it a Dream target yourself, whatever its score.</Text>
        </div>
      </div>
    </details>
  );
}

export const Kind = ({ kind }) => <Badge variant={KIND_COLOR[kind] || "neutral"} label={kind} />;
export const Stage = ({ stage }) => <Badge variant={STAGE_COLOR[stage] || "neutral"} label={stage} />;

export function DreamStar({ item, onToggle }) {
  return (
    <button
      type="button"
      className={`dream-star${item.dream ? " on" : ""}`}
      aria-pressed={item.dream ? "true" : "false"}
      title={item.dream ? "Dream target: researched and drafted automatically. Click to unmark." : "Mark as a Dream target: it jumps to the top tier and gets researched and drafted automatically"}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <Star size={16} fill={item.dream ? "currentColor" : "none"} />
    </button>
  );
}

export function WhyNow({ item, compact }) {
  if (!item.why_now) return null;
  const links = sources(item);
  return (
    <div className={`whynow${compact ? " compact" : ""}`}>
      <Text size="sm" color="secondary" as="span" weight="semibold">Why now </Text>
      <Text size="sm" as="span">{item.why_now}</Text>
      {links.length > 0 && (
        <HStack gap={1} wrap="wrap" style={{ marginTop: 6 }}>
          {links.map((s) => <Token key={s.url} size="sm" color="blue" label={s.title} href={safeUrl(s.url)} />)}
        </HStack>
      )}
    </div>
  );
}
