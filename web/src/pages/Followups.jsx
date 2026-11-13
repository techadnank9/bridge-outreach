import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Reply } from "lucide-react";
import { useApp, followups } from "../data.js";
import { ContactTable } from "./Pipeline.jsx";

export function Followups() {
  const { S } = useApp();
  const list = followups(S).sort((a, b) => new Date(a.last_contacted) - new Date(b.last_contacted));
  const days = S.settings.followup_days;
  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={1}>Follow-ups</Heading>
        <Text color="secondary">People you contacted {days} or more days ago who have not replied. Each follow-up is drafted into Today for your yes, shorter than the first email with one new thing. After three, move on.</Text>
      </VStack>
      {list.length ? <ContactTable list={list} /> : (
        <EmptyState icon={<Reply size={28} />} title="Nothing to chase" description={`Follow-ups appear here once a contacted person has been quiet for ${days} days.`} />
      )}
    </VStack>
  );
}
