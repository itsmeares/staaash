"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import confetti from "canvas-confetti";
import {
  DEFAULT_TIME_ZONE,
  getBrowserTimeZone,
} from "@staaash/config/time-zone";

import { saveOwnerOnboardingSettings } from "@/app/admin/settings/actions";
import { TimeZonePicker } from "@/components/time-zone-picker";

type Theme = "light" | "dark" | "system";
type OnboardingStep =
  | "welcome"
  | "theme"
  | "timezone"
  | "profile"
  | "privacy"
  | "media"
  | "done";

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

function applyThemePreview(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  if (theme === "dark") html.classList.add("dark");
  else if (theme === "light") html.classList.add("light");
}

export function OnboardingExperience({
  instanceName,
  isOwner,
  initialMediaPreviewEnabled = true,
}: {
  instanceName?: string;
  isOwner: boolean;
  initialMediaPreviewEnabled?: boolean;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [animating, setAnimating] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    theme: "system",
    timeZone: DEFAULT_TIME_ZONE,
    showUpdateNotifications: true,
    enableVersionChecks: true,
    displayName: "",
    avatarUrl: null,
  });
  const [mediaPreviewEnabled, setMediaPreviewEnabled] = useState(
    initialMediaPreviewEnabled,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donePhase, setDonePhase] = useState<0 | 1 | 2>(0);
  const [nameSwapping, setNameSwapping] = useState(false);
  const stepContainerRef = useRef<HTMLDivElement>(null);
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
    applyThemePreview(t);
  }

  function setTimeZone(timeZone: string) {
    setPrefs((p) => ({ ...p, timeZone }));
  }

  async function handleComplete() {
    setPending(true);
    setError(null);
    try {
      const tasks: Promise<unknown>[] = [
        fetch("/api/user/preferences", {
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
        }).then(async (res) => {
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error ?? "Something went wrong.");
          }
        }),
      ];
      if (isOwner) {
        tasks.push(
          saveOwnerOnboardingSettings({
            mediaPreviewEnabled,
            timeZone: prefs.timeZone,
          }).then((result) => {
            if (result?.error) throw new Error(result.error);
          }),
        );
      }
      await Promise.all(tasks);
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

  useEffect(() => {
    setPrefs((p) =>
      p.timeZone === DEFAULT_TIME_ZONE
        ? { ...p, timeZone: getBrowserTimeZone() }
        : p,
    );
  }, []);

  useEffect(() => {
    if (step === "welcome" || step === "done") return;
    const frame = requestAnimationFrame(() => {
      stepContainerRef.current
        ?.querySelector<HTMLElement>("[data-step-focus]")
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  if (step === "done") {
    const effectiveName = instanceName ?? "Staaash";
    const isCustomName = effectiveName !== "Staaash";

    return (
      <div className="onboarding-done" role="status" aria-live="polite">
        <div
          className={`onboarding-done__phase onboarding-done__phase--allset${donePhase > 0 ? " is-exiting" : ""}`}
        >
          <p className="onboarding-done__message">You&apos;re all set.</p>
        </div>
        <div
          className={`onboarding-done__phase onboarding-done__phase--brand${donePhase >= 1 ? " is-entering" : ""}`}
        >
          <p className="onboarding-done__message">
            Welcome to{" "}
            {isCustomName && donePhase >= 2 ? (
              <span className="onboarding-done__name-wrap">
                <span
                  className={`onboarding-done__name-brand${nameSwapping ? " is-out" : ""}`}
                >
                  Staaash
                </span>
                <span
                  className={`onboarding-done__name-instance${nameSwapping ? " is-in" : ""}`}
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
      ref={stepContainerRef}
      className={`onboarding${animating ? " onboarding--exiting" : " onboarding--entering"}`}
    >
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
    <section className="onboarding-welcome">
      <h1 className="onboarding-welcome__title">Before you dive in.</h1>
      <button
        className="onboarding-welcome__hint onboarding-welcome-action"
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
    <div
      className="onboarding-progress"
      aria-label={`Step ${current} of ${total}`}
    >
      <ol className="sr-only">
        {Array.from({ length: total }, (_, i) => (
          <li key={i} aria-current={i + 1 === current ? "step" : undefined}>
            Step {i + 1}
            {i + 1 === current ? " of onboarding, current step" : ""}
          </li>
        ))}
      </ol>
      <div className="onboarding-progress__visual" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`onboarding-progress__segment${i < current ? " onboarding-progress__segment--active" : ""}`}
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
  return (
    <div className="onboarding-step">
      <div className="onboarding-step__nav">
        <button
          className="onboarding-back"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={1} total={totalSteps} />
      </div>

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">01</span>
        <h2 className="onboarding-step__title" tabIndex={-1} data-step-focus>
          Choose your theme
        </h2>
      </div>

      <div
        className="onboarding-theme-grid"
        role="radiogroup"
        aria-label="Theme"
      >
        {THEME_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`onboarding-theme-tile onboarding-theme-tile--variant-${opt.value}${theme === opt.value ? " onboarding-theme-tile--selected" : ""}`}
          >
            <input
              className="onboarding-theme-input"
              type="radio"
              name="onboarding-theme"
              value={opt.value}
              checked={theme === opt.value}
              onChange={() => onSelect(opt.value)}
            />
            <ThemePreview variant={opt.value} />
            <span className="onboarding-theme-tile__label">{opt.label}</span>
            <span className="onboarding-theme-tile__desc">{opt.desc}</span>
          </label>
        ))}
      </div>

      <button
        className="onboarding-continue"
        onClick={onContinue}
        type="button"
      >
        Continue
      </button>
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
    <div className="onboarding-step">
      <div className="onboarding-step__nav">
        <button
          className="onboarding-back"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={2} total={totalSteps} />
      </div>

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">02</span>
        <h2 className="onboarding-step__title" tabIndex={-1} data-step-focus>
          Set your time zone
        </h2>
      </div>

      <p className="onboarding-step__body">
        Used for dates, activity, and schedules shown to you.
      </p>

      <div className="onboarding-field">
        <label className="onboarding-field__label" htmlFor="ob-timeZone">
          Time zone
        </label>
        <TimeZonePicker
          className="onboarding-field__input"
          id="ob-timeZone"
          value={timeZone}
          onChange={onSelect}
        />
        <span className="onboarding-field__help">
          Detected from this browser. You can update it later.
        </span>
      </div>

      <button
        className="onboarding-continue"
        onClick={onContinue}
        type="button"
      >
        Continue
      </button>
    </div>
  );
}

function PreviewContent() {
  return (
    <>
      <div className="theme-preview__sidebar" />
      <div className="theme-preview__main">
        <div className="theme-preview__bar" />
        <div className="theme-preview__bar theme-preview__bar--short" />
        <div className="theme-preview__bar theme-preview__bar--shorter" />
      </div>
    </>
  );
}

function ThemePreview({ variant }: { variant: Theme }) {
  if (variant === "system") {
    return (
      <div className="theme-preview theme-preview--system" aria-hidden="true">
        <div className="theme-preview__half theme-preview__half--light">
          <PreviewContent />
        </div>
        <div className="theme-preview__half theme-preview__half--dark">
          <PreviewContent />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`theme-preview theme-preview--${variant}`}
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
    <div className="onboarding-step">
      <div className="onboarding-step__nav">
        <button
          className="onboarding-back"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={stepIndex} total={totalSteps} />
      </div>

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">{indexStr}</span>
        <h2 className="onboarding-step__title" tabIndex={-1} data-step-focus>
          Your profile
        </h2>
      </div>

      <div className="onboarding-profile">
        <div className="onboarding-avatar">
          <button
            type="button"
            className="onboarding-avatar__btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Choose profile picture"
          >
            <span className="onboarding-avatar__inner">
              {prefs.avatarUrl ? (
                <img
                  className="onboarding-avatar__img"
                  src={prefs.avatarUrl}
                  alt=""
                />
              ) : initials ? (
                <span className="onboarding-avatar__initials">{initials}</span>
              ) : (
                <svg
                  className="onboarding-avatar__icon"
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
          <span className="onboarding-avatar__hint">Select photo</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>

        <div className="onboarding-field">
          <label className="onboarding-field__label" htmlFor="ob-displayName">
            Full name
          </label>
          <input
            className="onboarding-field__input"
            id="ob-displayName"
            type="text"
            placeholder="Your name"
            value={prefs.displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            maxLength={80}
          />
          <span className="onboarding-field__help">
            Optional — you can update this later.
          </span>
        </div>
      </div>

      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}

      <button
        className="onboarding-continue"
        onClick={onContinue}
        disabled={pending}
        type="button"
      >
        {pending ? "Saving…" : isLastStep ? "Enter Staaash" : "Continue"}
      </button>
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
    <div className="onboarding-step">
      <div className="onboarding-step__nav">
        <button
          className="onboarding-back"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={4} total={5} />
      </div>

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">04</span>
        <h2 className="onboarding-step__title" tabIndex={-1} data-step-focus>
          Privacy &amp; features
        </h2>
      </div>

      <p className="onboarding-step__body">
        Periodically checks GitHub for new releases. Sends no personal data.
        Disable to keep Staaash fully offline.
      </p>

      <div className="onboarding-toggles">
        <label className="onboarding-toggle" htmlFor="ob-version-checks">
          <input
            id="ob-version-checks"
            role="switch"
            className="onboarding-switch-input"
            type="checkbox"
            checked={prefs.enableVersionChecks}
            onChange={(event) =>
              onVersionChecksChange(event.currentTarget.checked)
            }
            aria-describedby="ob-version-checks-desc"
          />
          <div className="onboarding-toggle__text">
            <span className="onboarding-toggle__label">Version checks</span>
            <span
              className="onboarding-toggle__desc"
              id="ob-version-checks-desc"
            >
              Check GitHub for updates and show a badge when a new version is
              available.
            </span>
          </div>
          <span className="onboarding-switch" aria-hidden="true">
            <span className="onboarding-switch__thumb" />
          </span>
        </label>
      </div>

      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}

      <button
        className="onboarding-continue"
        onClick={onComplete}
        disabled={pending}
        type="button"
      >
        {pending ? "Saving…" : isLastStep ? "Enter Staaash" : "Continue"}
      </button>
    </div>
  );
}

function MediaStep({
  enabled,
  onToggle,
  onComplete,
  onBack,
  pending,
  error,
}: {
  enabled: boolean;
  onToggle: (val: boolean) => void;
  onComplete: () => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="onboarding-step">
      <div className="onboarding-step__nav">
        <button
          className="onboarding-back"
          onClick={onBack}
          type="button"
          aria-label="Go back"
        >
          ← Back
        </button>
        <StepProgress current={5} total={5} />
      </div>

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">05</span>
        <h2 className="onboarding-step__title" tabIndex={-1} data-step-focus>
          Media previews
        </h2>
      </div>

      <p className="onboarding-step__body">
        Staaash can transcode uploaded videos into streamable previews using
        FFmpeg. This runs in a background worker and can use significant CPU.
        You can change this anytime in Admin → Settings.
      </p>

      <div className="onboarding-toggles">
        <label className="onboarding-toggle" htmlFor="ob-media-previews">
          <input
            id="ob-media-previews"
            role="switch"
            className="onboarding-switch-input"
            type="checkbox"
            checked={enabled}
            onChange={(event) => onToggle(event.currentTarget.checked)}
            aria-describedby="ob-media-previews-desc"
          />
          <div className="onboarding-toggle__text">
            <span className="onboarding-toggle__label">
              Enable media previews
            </span>
            <span
              className="onboarding-toggle__desc"
              id="ob-media-previews-desc"
            >
              Generates compressed video previews on demand. Requires a worker
              process and a reasonably capable CPU.
            </span>
          </div>
          <span className="onboarding-switch" aria-hidden="true">
            <span className="onboarding-switch__thumb" />
          </span>
        </label>
      </div>

      {error && (
        <p className="onboarding-error" role="alert">
          {error}
        </p>
      )}

      <button
        className="onboarding-continue"
        onClick={onComplete}
        disabled={pending}
        type="button"
      >
        {pending ? "Saving…" : "Enter Staaash"}
      </button>
    </div>
  );
}
