"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";

type Theme = "light" | "dark" | "system";
type OnboardingStep = "welcome" | "theme" | "privacy" | "done";

type Prefs = {
  theme: Theme;
  showUpdateNotifications: boolean;
  enableVersionChecks: boolean;
};

const STEP_ORDER: OnboardingStep[] = ["welcome", "theme", "privacy", "done"];

function applyThemePreview(theme: Theme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  if (theme === "dark") html.classList.add("dark");
  else if (theme === "light") html.classList.add("light");
}

export function OnboardingExperience({
  instanceName,
}: {
  instanceName?: string;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [animating, setAnimating] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    theme: "system",
    showUpdateNotifications: true,
    enableVersionChecks: true,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donePhase, setDonePhase] = useState<0 | 1 | 2>(0);
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

  function setTheme(t: Theme) {
    setPrefs((p) => ({ ...p, theme: t }));
    applyThemePreview(t);
  }

  async function handleComplete() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/user/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(prefs),
      });
      if (res.ok) {
        setStep("done");
        setTimeout(() => router.push("/files"), 4800);
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Something went wrong.");
        setPending(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  useEffect(() => {
    if (step !== "done") return;

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
    const t2 = setTimeout(() => setDonePhase(2), 3300);

    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [step]);

  if (step === "done") {
    const effectiveName = instanceName ?? "Staaash";
    const isCustomName = effectiveName !== "Staaash";

    return (
      <div className="onboarding-done">
        <div
          className={`onboarding-done__phase onboarding-done__phase--allset${donePhase > 0 ? " is-exiting" : ""}`}
        >
          <p className="onboarding-done__message">You&apos;re all set.</p>
        </div>
        <div
          className={`onboarding-done__phase onboarding-done__phase--welcome${donePhase >= 1 ? " is-entering" : ""}`}
        >
          <p className="onboarding-done__message">
            Welcome to{" "}
            <span className="onboarding-done__name-wrap">
              <span
                className={`onboarding-done__name-brand${donePhase >= 2 && isCustomName ? " is-out" : ""}`}
              >
                Staaash
              </span>
              {isCustomName && (
                <span
                  className={`onboarding-done__name-instance${donePhase >= 2 ? " is-in" : ""}`}
                >
                  {effectiveName}
                </span>
              )}
            </span>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`onboarding${animating ? " onboarding--exiting" : " onboarding--entering"}`}
    >
      {step === "welcome" && (
        <WelcomeStep instanceName={instanceName} onContinue={advance} />
      )}
      {step === "theme" && (
        <ThemeStep
          theme={prefs.theme}
          onSelect={setTheme}
          onContinue={advance}
        />
      )}
      {step === "privacy" && (
        <PrivacyStep
          prefs={prefs}
          onChange={(key, val) => setPrefs((p) => ({ ...p, [key]: val }))}
          onComplete={handleComplete}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}

function WelcomeStep({
  instanceName,
  onContinue,
}: {
  instanceName?: string;
  onContinue: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onContinue();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onContinue]);

  return (
    <section
      className="onboarding-welcome"
      tabIndex={0}
      onClick={onContinue}
      aria-label="Welcome — click anywhere to begin setup"
    >
      <h1 className="onboarding-welcome__title">
        Welcome to {instanceName ?? "Staaash"}.
      </h1>
      <p className="onboarding-welcome__hint" aria-hidden="true">
        Click anywhere to continue
      </p>
    </section>
  );
}

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="onboarding-progress" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`onboarding-progress__segment${i < current ? " onboarding-progress__segment--active" : ""}`}
        />
      ))}
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
}: {
  theme: Theme;
  onSelect: (t: Theme) => void;
  onContinue: () => void;
}) {
  return (
    <div className="onboarding-step">
      <StepProgress current={1} total={2} />

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">01</span>
        <h2 className="onboarding-step__title">Choose your theme</h2>
      </div>

      <div
        className="onboarding-theme-grid"
        role="radiogroup"
        aria-label="Theme"
      >
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            role="radio"
            aria-checked={theme === opt.value}
            className={`onboarding-theme-tile${theme === opt.value ? " onboarding-theme-tile--selected" : ""}`}
            onClick={() => onSelect(opt.value)}
            type="button"
          >
            <ThemePreview variant={opt.value} />
            <span className="onboarding-theme-tile__label">{opt.label}</span>
            <span className="onboarding-theme-tile__desc">{opt.desc}</span>
          </button>
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

function ThemePreview({ variant }: { variant: Theme }) {
  return (
    <div
      className={`theme-preview theme-preview--${variant}`}
      aria-hidden="true"
    >
      <div className="theme-preview__sidebar" />
      <div className="theme-preview__main">
        <div className="theme-preview__bar" />
        <div className="theme-preview__bar theme-preview__bar--short" />
        <div className="theme-preview__bar theme-preview__bar--shorter" />
      </div>
    </div>
  );
}

const PRIVACY_TOGGLES: {
  key: keyof Pick<Prefs, "showUpdateNotifications" | "enableVersionChecks">;
  label: string;
  desc: string;
}[] = [
  {
    key: "showUpdateNotifications",
    label: "Update notifications",
    desc: "Show a badge when a new version of Staaash is available.",
  },
  {
    key: "enableVersionChecks",
    label: "Version checks",
    desc: "Periodically check GitHub for new releases. Sends no personal data.",
  },
];

function PrivacyStep({
  prefs,
  onChange,
  onComplete,
  pending,
  error,
}: {
  prefs: Prefs;
  onChange: (key: keyof Prefs, val: boolean) => void;
  onComplete: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="onboarding-step">
      <StepProgress current={2} total={2} />

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">02</span>
        <h2 className="onboarding-step__title">Privacy &amp; features</h2>
      </div>

      <p className="onboarding-step__body">
        These features reach external services. All are on by default — turn off
        anything you&apos;d rather keep fully local.
      </p>

      <div className="onboarding-toggles">
        {PRIVACY_TOGGLES.map((t) => (
          <label key={t.key} className="onboarding-toggle">
            <div className="onboarding-toggle__text">
              <span className="onboarding-toggle__label">{t.label}</span>
              <span className="onboarding-toggle__desc">{t.desc}</span>
            </div>
            <button
              role="switch"
              aria-checked={prefs[t.key]}
              className={`onboarding-switch${prefs[t.key] ? " onboarding-switch--on" : ""}`}
              onClick={() => onChange(t.key, !prefs[t.key])}
              type="button"
              aria-label={t.label}
            >
              <span className="onboarding-switch__thumb" />
            </button>
          </label>
        ))}
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
