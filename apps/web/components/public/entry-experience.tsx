"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type Phase =
  | "intro"
  | "intro-return"
  | "transitioning"
  | "form"
  | "exiting-to-intro"
  | "success";

type EntryExperienceProps = {
  mode: "setup" | "signin";
  phase: Phase;
  setPhase: (phase: Phase) => void;
  instanceName?: string;
};

const config = {
  setup: {
    title: "Bring your Staaash online.",
    description:
      "Create the first owner account. After this, your instance is private and invite-only.",
    endpoint: "/api/auth/setup",
    successMessage: "Welcome to your Staaash.",
  },
  signin: {
    title: "Your Staaash.",
    description: "Sign in to open your files.",
    endpoint: "/api/auth/sign-in",
    successMessage: "Welcome back.",
  },
} as const;

export function EntryExperience({
  mode,
  phase,
  setPhase,
  instanceName,
}: EntryExperienceProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const { description, endpoint, successMessage } = config[mode];
  const title =
    mode === "signin" && instanceName ? instanceName : config[mode].title;

  // Click-anywhere handler — active during intro and intro-return phases
  useEffect(() => {
    if (phase !== "intro" && phase !== "intro-return") return;

    const advance = (e: MouseEvent) => {
      if ((e.target as Element).closest(".entry-brand")) return;
      setPhase("transitioning");
      setTimeout(() => setPhase("form"), 360);
    };

    document.addEventListener("click", advance);
    return () => document.removeEventListener("click", advance);
  }, [phase]);

  // Focus first field when form appears
  useEffect(() => {
    if (phase === "form") {
      firstFieldRef.current?.focus();
    }
  }, [phase]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const data = Object.fromEntries(new FormData(e.currentTarget));

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (res.ok) {
        setPhase("success");
        setTimeout(() => router.push("/library"), 1600);
      } else {
        setError(json.error ?? "Something went wrong. Please try again.");
        setPending(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  // Intro (initial load, return from form, and transitioning to form)
  if (
    phase === "intro" ||
    phase === "intro-return" ||
    phase === "transitioning"
  ) {
    const isExiting = phase === "transitioning";
    const isReturning = phase === "intro-return";
    const isActive = phase === "intro" || phase === "intro-return";

    return (
      <section
        className={[
          "entry-intro",
          isReturning && "entry-intro--returning",
          isExiting && "entry-intro--exiting",
        ]
          .filter(Boolean)
          .join(" ")}
        tabIndex={isActive ? 0 : -1}
        aria-label={
          mode === "setup"
            ? "First launch — click anywhere or press Enter to begin setup"
            : "Sign in — click anywhere or press Enter to continue"
        }
        onKeyDown={(e) => {
          if (isActive && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setPhase("transitioning");
            setTimeout(() => setPhase("form"), 360);
          }
        }}
      >
        <h1 className="entry-intro__title">{title}</h1>
        <p className="entry-intro__description">{description}</p>
        <p className="entry-intro__hint" aria-hidden="true">
          Click anywhere to begin
        </p>
      </section>
    );
  }

  // Success
  if (phase === "success") {
    return (
      <div className="entry-success">
        <p className="entry-success__message">{successMessage}</p>
      </div>
    );
  }

  // Form (including exiting-to-intro state)
  return (
    <div
      className={`entry-form ${phase === "exiting-to-intro" ? "entry-form--exiting" : "entry-form--entering"}`}
    >
      {error && (
        <p className="entry-form__error" role="alert">
          {error}
        </p>
      )}

      <form className="entry-form__fields" onSubmit={handleSubmit}>
        {mode === "setup" ? (
          <>
            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="instanceName">
                Instance name
              </label>
              <input
                ref={firstFieldRef}
                className="entry-form__input"
                id="instanceName"
                name="instanceName"
                placeholder="Staaash Home Drive"
                required
              />
            </div>

            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="username">
                Username
              </label>
              <input
                className="entry-form__input"
                id="username"
                name="username"
                autoComplete="username"
                maxLength={32}
                minLength={3}
                pattern="^(?!-)(?!.*--)[a-z0-9-]{3,32}(?<!-)$"
                placeholder="johndoe"
                required
              />
              <span className="entry-form__help">
                Lowercase letters, numbers, and single hyphens.
              </span>
            </div>

            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="displayName">
                Display name
              </label>
              <input
                className="entry-form__input"
                id="displayName"
                name="displayName"
                placeholder="John Doe"
              />
            </div>

            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="email">
                Email
              </label>
              <input
                className="entry-form__input"
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="john@example.com"
                required
              />
            </div>

            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="password">
                Password
              </label>
              <input
                className="entry-form__input"
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
              <span className="entry-form__help">At least 12 characters.</span>
            </div>
          </>
        ) : (
          <>
            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="identifier">
                Username or email
              </label>
              <input
                ref={firstFieldRef}
                className="entry-form__input"
                id="identifier"
                name="identifier"
                autoComplete="username"
                required
              />
            </div>

            <div className="entry-form__field">
              <label className="entry-form__label" htmlFor="password">
                Password
              </label>
              <input
                className="entry-form__input"
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          </>
        )}

        <button className="entry-form__submit" type="submit" disabled={pending}>
          {pending
            ? mode === "setup"
              ? "Setting up…"
              : "Signing in…"
            : mode === "setup"
              ? "Create owner and continue"
              : "Sign in"}
        </button>
      </form>
    </div>
  );
}
