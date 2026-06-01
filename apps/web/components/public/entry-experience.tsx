"use client";

import React, { useEffect, useRef, useState } from "react";

import { USERNAME_INPUT_PATTERN } from "@/lib/user";

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
  next?: string;
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
  next,
}: EntryExperienceProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const advancingRef = useRef(false);

  const { description, endpoint, successMessage } = config[mode];
  const title =
    mode === "signin" && instanceName ? instanceName : config[mode].title;

  const advanceToForm = () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    setPhase("transitioning");
    setTimeout(() => {
      setPhase("form");
      advancingRef.current = false;
    }, 360);
  };

  // The intro is visually mouse-first, but Enter/Space remain hidden shortcuts.
  useEffect(() => {
    if (phase !== "intro" && phase !== "intro-return") return;
    advancingRef.current = false;

    const handleClick = () => advanceToForm();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      advanceToForm();
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const dest = mode === "signin" && next ? next : "/files";
        const needsOnboarding = !json.user?.preferences?.onboardingCompletedAt;

        if (needsOnboarding) {
          // Skip success animation — navigate immediately so middleware
          // redirects to / and the user lands straight on onboarding.
          window.location.assign(dest);
        } else {
          setPhase("success");
          setTimeout(() => window.location.assign(dest), 1600);
        }
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
      >
        <h1 className="entry-intro__title">{title}</h1>
        <p className="entry-intro__description">{description}</p>
        <button
          className="entry-intro__hint entry-intro-action"
          disabled={!isActive}
          onClick={advanceToForm}
          type="button"
        >
          Click anywhere to begin
        </button>
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
                pattern={USERNAME_INPUT_PATTERN}
                placeholder="johndoe"
                required
              />
              <span className="entry-form__help">
                Lowercase letters, numbers, and single hyphens.
              </span>
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
              <label className="entry-form__label" htmlFor="email">
                Username or email
              </label>
              <input
                ref={firstFieldRef}
                className="entry-form__input"
                id="email"
                name="identifier"
                autoComplete="email"
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
