// Small pieces shared by every page: score grade, tier, lead type, stage, the dream star.
import { Badge } from "@astryxdesign/core/Badge";
import { Token } from "@astryxdesign/core/Token";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Star } from "lucide-react";
import { KIND_COLOR, LEVEL_COLOR, STAGE_COLOR, safeUrl, sources } from "./data.js";

export function Grade({ rating }) {
  if (!rating) return null;
  const heat = { Hot: "orange", Warm: "yellow", Cold: "gray" }[rating.tier];
  return (
    <Tooltip content={rating.why.join("\n")}>
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
  return <Badge variant={LEVEL_COLOR[rating.level]} label={rating.level === 1 ? "★ Dream" : rating.levelName} />;
}

export const Kind = ({ kind }) => <Badge variant={KIND_COLOR[kind] || "neutral"} label={kind} />;
export const Stage = ({ stage }) => <Badge variant={STAGE_COLOR[stage] || "neutral"} label={stage} />;

export function DreamStar({ item, onToggle }) {
  return (
    <button
      type="button"
      className={`dream-star${item.dream ? " on" : ""}`}
      aria-pressed={item.dream ? "true" : "false"}
      title={item.dream ? "Dream target. Click to unmark." : "Mark as a dream target"}
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
