"use client";

import React, { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import styles from "./entry-experience.module.css";

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
      "Create the first owner account. After this, your instance is private.",
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
        className={cn(
          "grid max-w-[clamp(22rem,50vw,44rem)] cursor-default gap-4 text-center outline-none select-none md:gap-5",
          isReturning && styles.introReturning,
          isExiting && styles.introExiting,
        )}
      >
        <h1
          className={cn(
            "font-heading text-display tracking-tighter text-foreground",
            styles.introTitle,
          )}
        >
          {title}
        </h1>
        <p
          className={cn(
            "mx-auto max-w-120 text-base leading-relaxed text-muted-foreground",
            styles.introDescription,
          )}
        >
          {description}
        </p>
        <button
          className={cn(
            "mt-1 cursor-pointer rounded-xl border-0 bg-transparent p-0 text-xs font-medium tracking-widest text-muted-foreground uppercase outline-none focus-visible:outline-2 focus-visible:outline-offset-12 focus-visible:outline-primary/55 disabled:cursor-default",
            styles.introHint,
          )}
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
      <div className="grid place-items-center">
        <p
          className={cn(
            "font-heading text-display tracking-tighter text-foreground",
            styles.successMessage,
          )}
        >
          {successMessage}
        </p>
      </div>
    );
  }

  // Form (including exiting-to-intro state)
  return (
    <div
      data-entry-form
      className={cn(
        "grid w-[min(100%,380px)] gap-0",
        phase === "exiting-to-intro" ? styles.formExiting : styles.formEntering,
      )}
    >
      {error && (
        <p
          className="mb-3.5 text-center text-label leading-normal text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      <form className="grid gap-4.5" onSubmit={handleSubmit}>
        {mode === "setup" ? (
          <>
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium tracking-wide text-muted-foreground"
                htmlFor="instanceName"
              >
                Instance name
              </label>
              <Input
                ref={firstFieldRef}
                id="instanceName"
                name="instanceName"
                placeholder="Staaash Home Drive"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium tracking-wide text-muted-foreground"
                htmlFor="email"
              >
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="john@example.com"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium tracking-wide text-muted-foreground"
                htmlFor="password"
              >
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
              <span className="text-xs leading-normal text-muted-foreground">
                At least 12 characters.
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium tracking-wide text-muted-foreground"
                htmlFor="email"
              >
                Email
              </label>
              <Input
                ref={firstFieldRef}
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>

            <div className="grid gap-1.5">
              <label
                className="text-xs font-medium tracking-wide text-muted-foreground"
                htmlFor="password"
              >
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          </>
        )}

        <Button className="mt-1.5 w-full" type="submit" disabled={pending}>
          {pending
            ? mode === "setup"
              ? "Setting up…"
              : "Signing in…"
            : mode === "setup"
              ? "Create owner and continue"
              : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
