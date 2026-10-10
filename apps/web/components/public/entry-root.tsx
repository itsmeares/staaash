"use client";

import React, { useState } from "react";

import { EntryExperience, type Phase } from "./entry-experience";
import { EntryShell } from "./entry-shell";
import { OnboardingExperience } from "./onboarding-experience";
import { PasswordChangeExperience } from "./password-change-experience";
import { EntryBackground } from "./entry-background";

type EntryRootProps = {
  mode: "setup" | "signin" | "onboarding" | "password-change";
  instanceName?: string;
  appVersion?: string;
  next?: string;
  isOwner?: boolean;
  initialMediaPreviewEnabled?: boolean;
  initialMediaPreviewGenerateOnUpload?: boolean;
  initialMediaPreviewGenerateOnFirstView?: boolean;
  initialMediaPreviewGenerateOnShare?: boolean;
};

export function EntryRoot({
  mode,
  instanceName,
  appVersion,
  next,
  isOwner = false,
  initialMediaPreviewEnabled = true,
  initialMediaPreviewGenerateOnUpload = false,
  initialMediaPreviewGenerateOnFirstView = true,
  initialMediaPreviewGenerateOnShare = true,
}: EntryRootProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [onboardingKey, setOnboardingKey] = useState(0);

  function handleBrandClick() {
    setPhase("exiting-to-intro");
    setTimeout(() => setPhase("intro-return"), 320);
  }

  if (mode === "onboarding") {
    return (
      <EntryShell
        appVersion={appVersion}
        background={<EntryBackground />}
        instanceName={instanceName}
        contentClassName="justify-center"
        scrimVariant="setup"
        onBrandClick={() => setOnboardingKey((k) => k + 1)}
      >
        <OnboardingExperience
          key={onboardingKey}
          instanceName={instanceName}
          isOwner={isOwner}
          initialMediaPreviewEnabled={initialMediaPreviewEnabled}
          initialMediaPreviewGenerateOnUpload={
            initialMediaPreviewGenerateOnUpload
          }
          initialMediaPreviewGenerateOnFirstView={
            initialMediaPreviewGenerateOnFirstView
          }
          initialMediaPreviewGenerateOnShare={
            initialMediaPreviewGenerateOnShare
          }
        />
      </EntryShell>
    );
  }

  if (mode === "password-change") {
    return (
      <EntryShell
        appVersion={appVersion}
        background={<EntryBackground />}
        instanceName={instanceName}
        contentClassName="justify-center"
        scrimVariant="setup"
      >
        <PasswordChangeExperience />
      </EntryShell>
    );
  }

  return (
    <EntryShell
      appVersion={appVersion}
      background={<EntryBackground />}
      instanceName={instanceName}
      contentClassName="justify-center"
      scrimVariant="setup"
      onBrandClick={phase === "form" ? handleBrandClick : undefined}
    >
      <EntryExperience
        mode={mode}
        phase={phase}
        setPhase={setPhase}
        instanceName={instanceName}
        next={next}
      />
    </EntryShell>
  );
}
