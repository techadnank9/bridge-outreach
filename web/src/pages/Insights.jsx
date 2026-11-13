import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { LineChart } from "lucide-react";
import { useApp } from "../data.js";

const pct = (v) => `${Math.round(v * 100)}%`;

function Breakdown({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        {rows.map((r) => (
          <VStack key={r.name} gap={1}>
            <HStack gap={2} hAlign="between">
              <Text weight="medium">{r.name}</Text>
              <Text size="sm" color="secondary" hasTabularNumbers>{r.replied} of {r.sent} replied · {pct(r.rate)}</Text>
            </HStack>
            <ProgressBar label={`${r.name} reply rate`} isLabelHidden value={Math.round(r.rate * 100)} max={100} />
          </VStack>
        ))}
      </VStack>
    </Card>
  );
}

export function Insights() {
  const { S } = useApp();
  const I = S.insights;
  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={1}>What works</Heading>
        <Text color="secondary">Every email you send is recorded with what kind of message it was. When someone replies, it is credited to the last message they got. {I.sent < 20 ? "With fewer than 20 sends, treat these numbers as early signs, not answers." : ""}</Text>
      </VStack>
      {!I.sent ? (
        <EmptyState icon={<LineChart size={28} />} title="Nothing sent yet" description="Send or mark a few emails as sent and this page starts showing which kinds of message get replies." />
      ) : (
        <>
          <Grid columns={3} gap={3}>
            {[[I.sent, "messages sent"], [I.people, "people written to"], [`${I.repliedPeople} · ${I.people ? pct(I.repliedPeople / I.people) : "0%"}`, "people replied"]].map(([n, label]) => (
              <Card key={label} padding={4}><VStack gap={0}><span className="big-num">{n}</span><Text size="sm" color="secondary">{label}</Text></VStack></Card>
            ))}
          </Grid>
          <Grid columns={2} gap={3}>
            <Breakdown title="Which message got the reply" rows={I.byMessage} />
            <Breakdown title="First emails by type" rows={I.byKind} />
            <Breakdown title="First emails by tier" rows={I.byLevel} />
            <Breakdown title="Warm intro or cold" rows={I.byWarm} />
            <Breakdown title="With or without a why-now reason" rows={I.byWhyNow} />
          </Grid>
          {I.replied.length > 0 && (
            <Card padding={4}>
              <VStack gap={3}>
                <Heading level={3}>Messages that got replies</Heading>
                {I.replied.map((r, i) => (
                  <VStack key={i} gap={0}>
                    <Text weight="medium">{r.subject || "(no subject)"}</Text>
                    <Text size="sm" color="secondary">{r.opener}</Text>
                    <Text size="xsm" color="secondary">{r.name || r.org}{r.followup_n ? ` · follow-up ${r.followup_n}` : ""}</Text>
                  </VStack>
                ))}
                <Text size="sm" color="secondary">Once three first emails have replies, new drafts lean toward what these have in common.</Text>
              </VStack>
            </Card>
          )}
        </>
      )}
    </VStack>
  );
}
