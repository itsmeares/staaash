"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";

type Theme = "light" | "dark" | "system";
type OnboardingStep = "welcome" | "theme" | "profile" | "privacy" | "done";

type Prefs = {
  theme: Theme;
  showUpdateNotifications: boolean;
  enableVersionChecks: boolean;
  displayName: string;
  avatarUrl: string | null;
};

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "theme",
  "profile",
  "privacy",
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
}: {
  instanceName?: string;
  isOwner: boolean;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [animating, setAnimating] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({
    theme: "system",
    showUpdateNotifications: true,
    enableVersionChecks: true,
    displayName: "",
    avatarUrl: null,
  });
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
        body: JSON.stringify({
          theme: prefs.theme,
          showUpdateNotifications: prefs.showUpdateNotifications,
          enableVersionChecks: prefs.enableVersionChecks,
          displayName: prefs.displayName || null,
          avatarUrl: prefs.avatarUrl,
        }),
      });
      if (res.ok) {
        setStep("done");
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
      <div className="onboarding-done">
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

  const totalSteps = isOwner ? 3 : 2;

  return (
    <div
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
          stepIndex={2}
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
          onComplete={handleComplete}
          onBack={goBack}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  useEffect(() => {
    let ready = false;
    const guard = setTimeout(() => {
      ready = true;
    }, 300);

    const clickHandler = () => {
      if (ready) onContinue();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onContinue();
      }
    };

    document.addEventListener("click", clickHandler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      clearTimeout(guard);
      document.removeEventListener("click", clickHandler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onContinue]);

  return (
    <section
      className="onboarding-welcome"
      tabIndex={0}
      aria-label="Welcome — click anywhere to begin setup"
    >
      <h1 className="onboarding-welcome__title">Before you dive in.</h1>
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
            className={`onboarding-theme-tile onboarding-theme-tile--variant-${opt.value}${theme === opt.value ? " onboarding-theme-tile--selected" : ""}`}
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
        <h2 className="onboarding-step__title">Your profile</h2>
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
                  alt="Profile preview"
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
          <span className="onboarding-avatar__hint">Click to upload photo</span>
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
}: {
  prefs: Prefs;
  onVersionChecksChange: (val: boolean) => void;
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
        <StepProgress current={3} total={3} />
      </div>

      <div className="onboarding-step__header">
        <span className="onboarding-step__index">03</span>
        <h2 className="onboarding-step__title">Privacy &amp; features</h2>
      </div>

      <p className="onboarding-step__body">
        Periodically checks GitHub for new releases. Sends no personal data.
        Disable to keep Staaash fully offline.
      </p>

      <div className="onboarding-toggles">
        <label className="onboarding-toggle">
          <div className="onboarding-toggle__text">
            <span className="onboarding-toggle__label">Version checks</span>
            <span className="onboarding-toggle__desc">
              Check GitHub for updates and show a badge when a new version is
              available.
            </span>
          </div>
          <button
            role="switch"
            aria-checked={prefs.enableVersionChecks}
            className={`onboarding-switch${prefs.enableVersionChecks ? " onboarding-switch--on" : ""}`}
            onClick={() => onVersionChecksChange(!prefs.enableVersionChecks)}
            type="button"
            aria-label="Version checks"
          >
            <span className="onboarding-switch__thumb" />
          </button>
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
