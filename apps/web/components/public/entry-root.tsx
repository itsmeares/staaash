"use client";

import { useState } from "react";

import { STAAASH_BRONZE_HEX } from "@/lib/brand";

import { EntryExperience, type Phase } from "./entry-experience";
import { EntryShell } from "./entry-shell";
import { SilkBackground } from "./silk-background";

type EntryRootProps = {
  mode: "setup" | "signin";
  instanceName?: string;
};

export function EntryRoot({ mode, instanceName }: EntryRootProps) {
  const [phase, setPhase] = useState<Phase>("intro");

  function handleBrandClick() {
    setPhase("exiting-to-intro");
    setTimeout(() => setPhase("intro-return"), 320);
  }

  return (
    <EntryShell
      background={
        <SilkBackground
          color={STAAASH_BRONZE_HEX}
          noiseIntensity={1.1}
          opacity={0.56}
          rotation={0.1}
          scale={1.08}
          speed={4.2}
        />
      }
      contentClassName="justify-center"
      scrimVariant="setup"
      onBrandClick={phase === "form" ? handleBrandClick : undefined}
    >
      <EntryExperience
        mode={mode}
        phase={phase}
        setPhase={setPhase}
        instanceName={instanceName}
      />
    </EntryShell>
  );
}
