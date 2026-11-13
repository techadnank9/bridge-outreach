import { useState } from "react";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Upload } from "lucide-react";
import { useApp } from "../data.js";

export function Import() {
  const { S, act, toast, go } = useApp();
  const [csv, setCsv] = useState("");
  const [kind, setKind] = useState(S.kinds[0]);
  return (
    <VStack gap={5}>
      <VStack gap={1}>
        <Heading level={1}>Import a list</Heading>
        <Text color="secondary">Paste rows from a spreadsheet or a CSV export (OpenVC, Crunchbase, Apollo, a conference speaker list). The first row must be column names. Rows already in your pipeline are skipped.</Text>
      </VStack>
      <Card padding={4}>
        <VStack gap={3}>
          <div style={{ width: 280 }}><Selector label="Treat rows without a type as" options={S.kinds} value={kind} onChange={setKind} /></div>
          <TextArea label="Rows" rows={10} value={csv} onChange={setCsv} placeholder="company,name,title,email,linkedin,fit" />
          <div>
            <Button variant="primary" icon={<Upload size={16} />} label="Import" isDisabled={!csv.trim()} clickAction={async () => {
              const r = await act("POST", "/api/import", { csv, kind });
              toast({ body: `Added ${r.added} contact${r.added === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} (duplicates or empty rows)` : ""}.` });
              if (r.added) { setCsv(""); go("pipeline"); }
            }} />
          </div>
          <Text size="sm" color="secondary">Recognised columns: type, company (or firm, org, event), name, title (or role), email, linkedin, website, fit, warm path, stage, notes.</Text>
          <CodeBlock code={"company,name,title,email,linkedin,fit\nExample Capital,Jane Doe,Partner,jane@example.com,linkedin.com/in/janedoe,Backs future-of-work tools at seed"} language="csv" />
        </VStack>
      </Card>
    </VStack>
  );
}
