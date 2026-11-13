import { createRoot } from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "@designcodeio/threeui/style.css";
import "./login.css";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
import { Card } from "@astryxdesign/core/Card";
import { Button } from "@astryxdesign/core/Button";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Banner } from "@astryxdesign/core/Banner";
import { OrbitalSphereBackground } from "@designcodeio/threeui/components/OrbitalSphereBackground";
import OutreachDemo from "./demo/OutreachDemo.tsx";
import { useState } from "react";

const ERRORS = {
  wrong: "That password is not right.",
  locked: "Too many attempts. Try again in fifteen minutes.",
};

function Login() {
  const [password, setPassword] = useState("");
  const error = ERRORS[new URLSearchParams(location.search).get("error")];
  return (
    <main className="login">
      <div className="login-sphere" aria-hidden="true">
        <OrbitalSphereBackground speed={0.6} scale={0.9} particleOpacity={0.85} haloOpacity={0.5} orbitOpacity={0.5} hue={-70} />
      </div>
      <section className="login-side">
        <VStack gap={6}>
          <VStack gap={2}>
            <Text color="secondary" weight="medium">Bridge Outreach</Text>
            <Heading level={1} type="display-2">The right people, written to like a person would.</Heading>
            <Text color="secondary" size="lg">Find investors, partners, conferences and communities. Know why to write today. Approve every note before it goes.</Text>
          </VStack>
          <Card padding={5} maxWidth={400} elevation="med">
            <form method="post" action="/login">
              <VStack gap={3}>
                <TextInput label="Password" type="password" htmlName="password" value={password} onChange={setPassword} autoComplete="current-password" hasAutoFocus isRequired />
                {error && <Banner status="error" title={error} />}
                <Button type="submit" variant="primary" label="Sign in" width="100%" />
              </VStack>
            </form>
          </Card>
        </VStack>
      </section>
      <section className="login-demo" aria-label="How Bridge Outreach works">
        <OutreachDemo />
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <Theme theme={neutralTheme} mode="dark"><Login /></Theme>,
);
