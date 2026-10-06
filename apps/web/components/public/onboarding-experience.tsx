"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import confetti from "canvas-confetti";
import { AUTO_TIME_ZONE, getBrowserTimeZone } from "@staaash/config/time-zone";

import { saveOwnerOnboardingSettings } from "@/app/admin/settings/actions";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { applyTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import styles from "./onboarding-experience.module.css";

type Theme = "light" | "dark" | "system";
type OnboardingStep =
  "welcome" | "theme" | "timezone" | "profile" | "privacy" | "media" | "done";

type Prefs = {
  theme: Theme;
  timeZone: string;
  showUpdateNotifications: boolean;
  enableVersionChecks: boolean;
  displayName: string;
  avatarUrl: string | null;
};

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "theme",
  "timezone",
  "profile",
  "privacy",
  "media",
  "done",
];

const STEP_ANNOUNCEMENTS: Record<OnboardingStep, string> = {
  welcome: "Before you dive in.",
  theme: "Choose your theme.",
  timezone: "Set your time zone.",
  profile: "Your profile.",
  privacy: "Privacy and features.",
  media: "Media previews.",
  done: "Onboarding complete.",
};

const doneMessageClass = cn(
  "text-center font-heading leading-tight tracking-tighter whitespace-nowrap text-foreground",
  styles.doneMessage,
);

export function OnboardingExperience({
  instanceName,
  isOwner,
  initialMediaPreviewEnabled = true,
  initialMediaPreviewGenerateOnUpload = false,
  initialMediaPreviewGenerateOnFirstView = true,
  initialMediaPreviewGenerateOnShare = true,
}: {
  instanceName?: string;
  isOwner: boolean;
  initialMediaPreviewEnabled?: boolean;
  initialMediaPreviewGenerateOnUpload?: boolean;
  initialMediaPreviewGenerateOnFirstView?: boolean;
  initialMediaPreviewGenerateOnShare?: boolean;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [animating, setAnimating] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    theme: "system",
    timeZone: AUTO_TIME_ZONE,
    showUpdateNotifications: true,
    enableVersionChecks: true,
    displayName: "",
    avatarUrl: null,
  });
  const [mediaPreviewEnabled, setMediaPreviewEnabled] = useState(
    initialMediaPreviewEnabled,
  );
  const [mediaPreviewGenerateOnUpload, setMediaPreviewGenerateOnUpload] =
    useState(initialMediaPreviewGenerateOnUpload);
  const [mediaPreviewGenerateOnFirstView, setMediaPreviewGenerateOnFirstView] =
    useState(initialMediaPreviewGenerateOnFirstView);
  const [mediaPreviewGenerateOnShare, setMediaPreviewGenerateOnShare] =
    useState(initialMediaPreviewGenerateOnShare);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donePhase, setDonePhase] = useState<0 | 1 | 2>(0);
  const [nameSwapping, setNameSwapping] = useState(false);
  const router = useRouter();

  function advance() {
    if (animating) return;
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      setAnimating(true);
      setTimeout(() => {
        setStep(STEP_ORDER[idx + 1]);
        setAnimating(false);
      }, 260);
    }
  }

  function goBack() {
    if (animating) return;
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      setAnimating(true);
      setTimeout(() => {
        setStep(STEP_ORDER[idx - 1]);
        setAnimating(false);
      }, 260);
    }
  }

  function setTheme(t: Theme) {
    setPrefs((p) => ({ ...p, theme: t }));
    applyTheme(t);
  }

  function setTimeZone(timeZone: string) {
    setPrefs((p) => ({ ...p, timeZone }));
  }

  async function handleComplete() {
    setPending(true);
    setError(null);
    try {
      if (isOwner) {
        const result = await saveOwnerOnboardingSettings({
          mediaPreviewEnabled,
          mediaPreviewGenerateOnUpload,
          mediaPreviewGenerateOnFirstView,
          mediaPreviewGenerateOnShare,
          // The instance needs a fixed zone for its maintenance schedule.
          timeZone:
            prefs.timeZone === AUTO_TIME_ZONE
              ? getBrowserTimeZone()
              : prefs.timeZone,
        });
        if (result?.error) throw new Error(result.error);
      }

      const response = await fetch("/api/user/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          theme: prefs.theme,
          timeZone: prefs.timeZone,
          showUpdateNotifications: prefs.showUpdateNotifications,
          enableVersionChecks: prefs.enableVersionChecks,
          displayName: prefs.displayName || null,
          avatarUrl: prefs.avatarUrl,
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error ?? "Something went wrong.");
      }

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPending(false);
    }
  }

  useEffect(() => {
    if (step !== "done") return;

    const isCustomName = (instanceName ?? "Staaash") !== "Staaash";

    const t0 = setTimeout(() => {
      confetti({
        particleCount: 110,
        spread: 72,
        origin: { y: 0.48 },
        colors: ["#c8ab72", "#e5d0a0", "#8b6914", "#f5e6c8", "#ffffff"],
        disableForReducedMotion: true,
      });
    }, 350);

    const t1 = setTimeout(() => setDonePhase(1), 1900);
    const t2 = isCustomName
      ? setTimeout(() => setDonePhase(2), 3300)
      : undefined;
    const tNav = setTimeout(
      () => router.push("/files"),
      isCustomName ? 4800 : 3000,
    );

    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      if (t2) clearTimeout(t2);
      clearTimeout(tNav);
    };
  }, [step, instanceName, router]);

  useEffect(() => {
    if (donePhase < 2) return;
    const raf = requestAnimationFrame(() => setNameSwapping(true));
    return () => cancelAnimationFrame(raf);
  }, [donePhase]);

  if (step === "done") {
    const effectiveName = instanceName ?? "Staaash";
    const isCustomName = effectiveName !== "Staaash";

    return (
      <div
        className="grid w-full place-items-center"
        role="status"
        aria-live="polite"
      >
        <div
          className={cn(
            styles.phase,
            styles.phaseAllset,
            donePhase > 0 && styles.isExiting,
          )}
        >
          <p className={doneMessageClass}>You&apos;re all set.</p>
        </div>
        <div
          className={cn(
            styles.phase,
            styles.phaseBrand,
            donePhase >= 1 && styles.isEntering,
          )}
        >
          <p className={doneMessageClass}>
            Welcome to{" "}
            {isCustomName && donePhase >= 2 ? (
              <span className={styles.nameWrap}>
                <span
                  className={cn(styles.nameBrand, nameSwapping && styles.isOut)}
                >
                  Staaash
                </span>
                <span
                  className={cn(
                    styles.nameInstance,
                    nameSwapping && styles.isIn,
                  )}
                >
                  {effectiveName}
                </span>
              </span>
            ) : (
              <span>Staaash</span>
            )}
            .
          </p>
        </div>
      </div>
    );
  }

  const totalSteps = isOwner ? 5 : 3;

  return (
    <div
      className={cn(
        "grid w-full gap-0",
        animating ? styles.exiting : styles.entering,
      )}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {STEP_ANNOUNCEMENTS[step]}
      </p>
      {step === "welcome" && <WelcomeStep onContinue={advance} />}
      {step === "theme" && (
        <ThemeStep
          theme={prefs.theme}
          onSelect={setTheme}
          onContinue={advance}
          onBack={goBack}
          totalSteps={totalSteps}
        />
      )}
      {step === "timezone" && (
        <TimeZoneStep
          timeZone={prefs.timeZone}
          onSelect={setTimeZone}
          onContinue={advance}
          onBack={goBack}
          totalSteps={totalSteps}
        />
      )}
      {step === "profile" && (
        <ProfileStep
          prefs={prefs}
          onDisplayNameChange={(val) =>
            setPrefs((p) => ({ ...p, displayName: val }))
          }
          onAvatarChange={(val) => setPrefs((p) => ({ ...p, avatarUrl: val }))}
          onContinue={
            isOwner
              ? advance
              : () => {
                  void handleComplete();
                }
          }
          onBack={goBack}
          pending={!isOwner ? pending : false}
          error={!isOwner ? error : null}
          stepIndex={3}
          totalSteps={totalSteps}
          isLastStep={!isOwner}
        />
      )}
      {step === "privacy" && isOwner && (
        <PrivacyStep
          prefs={prefs}
          onVersionChecksChange={(val) =>
            setPrefs((p) => ({
              ...p,
              enableVersionChecks: val,
              showUpdateNotifications: val,
            }))
          }
          onComplete={advance}
          onBack={goBack}
          pending={false}
          error={null}
          isLastStep={false}
        />
      )}
      {step === "media" && isOwner && (
        <MediaStep
          enabled={mediaPreviewEnabled}
          onToggle={setMediaPreviewEnabled}
          generateOnUpload={mediaPreviewGenerateOnUpload}
          onGenerateOnUploadChange={setMediaPreviewGenerateOnUpload}
          generateOnFirstView={mediaPreviewGenerateOnFirstView}
          onGenerateOnFirstViewChange={setMediaPreviewGenerateOnFirstView}
          generateOnShare={mediaPreviewGenerateOnShare}
          onGenerateOnShareChange={setMediaPreviewGenerateOnShare}
          onComplete={() => {
            void handleComplete();
          }}
          onBack={goBack}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  const advancingRef = useRef(false);

  const advance = () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    onContinue();
  };

  useEffect(() => {
    advancingRef.current = false;

    const handleClick = () => advance();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      advance();
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onContinue]);

  return (
    <section className="grid w-full cursor-default gap-5 text-center outline-none select-none md:gap-7">
      <h1
        className={cn(
          "font-heading text-display tracking-tighter text-balance text-foreground",
          styles.welcomeTitle,
        )}
      >
        Before you dive in.
      </h1>
      <button
        className={cn(
          "mt-1.5 cursor-pointer rounded-xl border-0 bg-transparent p-0 text-xs font-medium tracking-widest text-foreground/40 uppercase outline-none focus-visible:outline-2 focus-visible:outline-offset-12 focus-visible:outline-primary/55",
          styles.welcomeHint,
        )}
        onClick={advance}
        type="button"
      >
        Click anywhere to continue
      </button>
    </section>
  );
}

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="block flex-1" aria-label={`Step ${current} of ${total}`}>
      <ol className="sr-only">
        {Array.from({ length: total }, (_, i) => (
          <li key={i} aria-current={i + 1 === current ? "step" : undefined}>
            Step {i + 1}
            {i + 1 === current ? " of onboarding, current step" : ""}
          </li>
        ))}
      </ol>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "block h-0.5 flex-1 rounded-full bg-muted-foreground/25 transition-colors duration-500 ease-expo-out motion-reduce:transition-none",
              i < current && "bg-primary",
            )}
          />
        ))}
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: Theme; label: string; desc: string }[] = [
  { value: "system", label: "System", desc: "Follows your OS setting" },
  { value: "light", label: "Light", desc: "Always light" },
  { value: "dark", label: "Dark", desc: "Always dark" },
];

function ThemeStep({
  theme,
  onSelect,
  onContinue,
  onBack,
  totalSteps = 2,
}: {
  theme: Theme;
  onSelect: (t: Theme) => void;
  onContinue: () => void;
  onBack: () => void;
  totalSteps?: number;
}) {
  const handleThemeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onContinue();
  };

  return (
    <div className="mx-auto grid w-[min(100%,420px)] gap-6">
      <div className="flex items-center gap-3">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-xs border-0 bg-transparent p-0 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 motion-reduce:transition-none"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={1} total={totalSteps} />
      </div>

      <div className="flex items-baseline gap-3.5">
        <span className="shrink-0 font-heading text-xs font-bold tracking-widest text-primary">
          01
        </span>
        <h2 className="m-0 font-heading text-headline tracking-tighter text-foreground md:text-3xl">
          Choose your theme
        </h2>
      </div>

      <div
        className="inline-grid w-full grid-cols-3 gap-2.5"
        role="radiogroup"
        aria-label="Theme"
      >
        {THEME_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={cn(
              "relative flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border border-line-strong bg-card/60 px-2.5 pt-3.5 pb-4 transition-colors hover:border-foreground/20 hover:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary/50 motion-reduce:transition-none",
              theme === opt.value &&
                "border-primary/80 bg-accent ring-1 ring-primary/25",
            )}
          >
            <input
              className="absolute inset-0 cursor-pointer opacity-0"
              type="radio"
              name="onboarding-theme"
              value={opt.value}
              checked={theme === opt.value}
              onChange={() => onSelect(opt.value)}
              onKeyDown={handleThemeKeyDown}
            />
            <ThemePreview variant={opt.value} />
            <span className="text-label font-semibold text-foreground">
              {opt.label}
            </span>
            <span className="text-center text-xs leading-snug text-muted-foreground/75">
              {opt.desc}
            </span>
          </label>
        ))}
      </div>

      <Button className="w-full" onClick={onContinue} type="button">
        Continue
      </Button>
    </div>
  );
}

function TimeZoneStep({
  timeZone,
  onSelect,
  onContinue,
  onBack,
  totalSteps,
}: {
  timeZone: string;
  onSelect: (timeZone: string) => void;
  onContinue: () => void;
  onBack: () => void;
  totalSteps: number;
}) {
  return (
    <div className="mx-auto grid w-[min(100%,420px)] gap-6">
      <div className="flex items-center gap-3">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-xs border-0 bg-transparent p-0 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 motion-reduce:transition-none"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={2} total={totalSteps} />
      </div>

      <div className="flex items-baseline gap-3.5">
        <span className="shrink-0 font-heading text-xs font-bold tracking-widest text-primary">
          02
        </span>
        <h2 className="m-0 font-heading text-headline tracking-tighter text-foreground md:text-3xl">
          Set your time zone
        </h2>
      </div>

      <p className="-mt-2 text-sm leading-relaxed text-muted-foreground">
        Used for dates, activity, and schedules shown to you.
      </p>

      <div className="flex flex-col gap-2">
        <label className="block text-label font-medium" htmlFor="ob-timeZone">
          Time zone
        </label>
        <TimeZonePicker
          className="block w-full rounded-lg border border-line-strong bg-muted px-3.5 py-2.5 text-sm text-foreground transition-colors focus-visible:border-primary/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 motion-reduce:transition-none"
          allowAuto
          id="ob-timeZone"
          value={timeZone}
          onChange={onSelect}
        />
        <span className="block text-xs text-muted-foreground">
          Automatic follows this browser. You can change it later.
        </span>
      </div>

      <Button className="w-full" onClick={onContinue} type="button">
        Continue
      </Button>
    </div>
  );
}

function PreviewContent() {
  return (
    <>
      <div className={styles.sidebar} />
      <div className={styles.main}>
        <div className={styles.bar} />
        <div className={cn(styles.bar, styles.barShort)} />
        <div className={cn(styles.bar, styles.barShorter)} />
      </div>
    </>
  );
}

function ThemePreview({ variant }: { variant: Theme }) {
  if (variant === "system") {
    return (
      <div className={styles.preview} aria-hidden="true">
        <div className={cn(styles.half, styles.halfLight, styles.swatchLight)}>
          <PreviewContent />
        </div>
        <div className={cn(styles.half, styles.halfDark, styles.swatchDark)}>
          <PreviewContent />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        styles.preview,
        variant === "light" ? styles.swatchLight : styles.swatchDark,
      )}
      aria-hidden="true"
    >
      <PreviewContent />
    </div>
  );
}

function ProfileStep({
  prefs,
  onDisplayNameChange,
  onAvatarChange,
  onContinue,
  onBack,
  pending,
  error,
  stepIndex,
  totalSteps,
  isLastStep,
}: {
  prefs: Prefs;
  onDisplayNameChange: (val: string) => void;
  onAvatarChange: (val: string | null) => void;
  onContinue: () => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
  stepIndex: number;
  totalSteps: number;
  isLastStep: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
        onAvatarChange(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = evt.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const initials = prefs.displayName
    ? prefs.displayName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : null;

  const indexStr = String(stepIndex).padStart(2, "0");

  return (
    <div className="mx-auto grid w-[min(100%,420px)] gap-6">
      <div className="flex items-center gap-3">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-xs border-0 bg-transparent p-0 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 motion-reduce:transition-none"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={stepIndex} total={totalSteps} />
      </div>

      <div className="flex items-baseline gap-3.5">
        <span className="shrink-0 font-heading text-xs font-bold tracking-widest text-primary">
          {indexStr}
        </span>
        <h2 className="m-0 font-heading text-headline tracking-tighter text-foreground md:text-3xl">
          Your profile
        </h2>
      </div>

      <div className="flex flex-col gap-7">
        <div className="text-center">
          <button
            type="button"
            className="relative mx-auto mb-2.5 block size-22 cursor-pointer overflow-hidden rounded-full border border-foreground/20 bg-hover p-0 transition-colors hover:border-primary/80 hover:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary/50"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Choose profile picture"
          >
            <span className="flex size-full items-center justify-center">
              {prefs.avatarUrl ? (
                <img
                  className="block size-full object-cover"
                  src={prefs.avatarUrl}
                  alt=""
                />
              ) : initials ? (
                <span className="font-heading text-3xl font-semibold text-muted-foreground select-none">
                  {initials}
                </span>
              ) : (
                <svg
                  className="text-muted-foreground"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" />
                </svg>
              )}
            </span>
          </button>
          <span className="block text-xs text-muted-foreground">
            Select photo
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            className="block text-label font-medium"
            htmlFor="ob-displayName"
          >
            Full name
          </label>
          <Input
            id="ob-displayName"
            type="text"
            placeholder="Your name"
            value={prefs.displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            maxLength={80}
          />
          <span className="block text-xs text-muted-foreground">
            Optional — you can update this later.
          </span>
        </div>
      </div>

      {error && (
        <p
          className="-mt-2 text-center text-label leading-normal text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <Button
        className="w-full"
        onClick={onContinue}
        disabled={pending}
        type="button"
      >
        {pending ? "Saving…" : isLastStep ? "Enter Staaash" : "Continue"}
      </Button>
    </div>
  );
}

function PrivacyStep({
  prefs,
  onVersionChecksChange,
  onComplete,
  onBack,
  pending,
  error,
  isLastStep = true,
}: {
  prefs: Prefs;
  onVersionChecksChange: (val: boolean) => void;
  onComplete: () => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
  isLastStep?: boolean;
}) {
  return (
    <div className="mx-auto grid w-[min(100%,420px)] gap-6">
      <div className="flex items-center gap-3">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-xs border-0 bg-transparent p-0 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 motion-reduce:transition-none"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={4} total={5} />
      </div>

      <div className="flex items-baseline gap-3.5">
        <span className="shrink-0 font-heading text-xs font-bold tracking-widest text-primary">
          04
        </span>
        <h2 className="m-0 font-heading text-headline tracking-tighter text-foreground md:text-3xl">
          Privacy &amp; features
        </h2>
      </div>

      <p className="-mt-2 text-sm leading-relaxed text-muted-foreground">
        Periodically checks GitHub for new releases. Sends no personal data.
        Disable to keep Staaash fully offline.
      </p>

      <div className="grid gap-0">
        <ToggleRow
          id="ob-version-checks"
          label="Version checks"
          description="Check GitHub for updates and show a badge when a new version is available."
          checked={prefs.enableVersionChecks}
          onCheckedChange={onVersionChecksChange}
        />
      </div>

      {error && (
        <p
          className="-mt-2 text-center text-label leading-normal text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <Button
        className="w-full"
        onClick={onComplete}
        disabled={pending}
        type="button"
      >
        {pending ? "Saving…" : isLastStep ? "Enter Staaash" : "Continue"}
      </Button>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-hairline py-4 first:border-t">
      <div className="grid gap-1">
        <label className="text-sm font-medium text-foreground" htmlFor={id}>
          {label}
        </label>
        <span
          className="text-xs leading-normal text-muted-foreground"
          id={`${id}-desc`}
        >
          {description}
        </span>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-desc`}
      />
    </div>
  );
}

function MediaStep({
  enabled,
  onToggle,
  generateOnUpload,
  onGenerateOnUploadChange,
  generateOnFirstView,
  onGenerateOnFirstViewChange,
  generateOnShare,
  onGenerateOnShareChange,
  onComplete,
  onBack,
  pending,
  error,
}: {
  enabled: boolean;
  onToggle: (val: boolean) => void;
  generateOnUpload: boolean;
  onGenerateOnUploadChange: (val: boolean) => void;
  generateOnFirstView: boolean;
  onGenerateOnFirstViewChange: (val: boolean) => void;
  generateOnShare: boolean;
  onGenerateOnShareChange: (val: boolean) => void;
  onComplete: () => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="mx-auto grid w-[min(100%,420px)] gap-6">
      <div className="flex items-center gap-3">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-xs border-0 bg-transparent p-0 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/50 motion-reduce:transition-none"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={5} total={5} />
      </div>

      <div className="flex items-baseline gap-3.5">
        <span className="shrink-0 font-heading text-xs font-bold tracking-widest text-primary">
          05
        </span>
        <h2 className="m-0 font-heading text-headline tracking-tighter text-foreground md:text-3xl">
          Media previews
        </h2>
      </div>

      <p className="-mt-2 text-sm leading-relaxed text-muted-foreground">
        Staaash can transcode videos into streamable previews using FFmpeg.
        Choose when automatic generation should happen. This runs in a
        background worker and can use significant CPU. You can change this
        anytime in Admin → Settings.
      </p>

      <div className="grid gap-0">
        <ToggleRow
          id="ob-media-previews"
          label="Enable media previews"
          description="Generates compressed video previews on demand. Requires a worker process and a reasonably capable CPU."
          checked={enabled}
          onCheckedChange={onToggle}
        />
        <ToggleRow
          id="ob-media-upload"
          label="Generate on upload"
          description="Start a preview when a qualifying video upload finishes."
          checked={generateOnUpload}
          onCheckedChange={onGenerateOnUploadChange}
        />
        <ToggleRow
          id="ob-media-first-view"
          label="Generate on first view"
          description="Start a preview after the first qualifying video view."
          checked={generateOnFirstView}
          onCheckedChange={onGenerateOnFirstViewChange}
        />
        <ToggleRow
          id="ob-media-share"
          label="Generate when shared"
          description="Create a preview and poster when a video is shared."
          checked={generateOnShare}
          onCheckedChange={onGenerateOnShareChange}
        />
      </div>

      {error && (
        <p
          className="-mt-2 text-center text-label leading-normal text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <Button
        className="w-full"
        onClick={onComplete}
        disabled={pending}
        type="button"
      >
        {pending ? "Saving…" : "Enter Staaash"}
      </Button>
    </div>
  );
}
