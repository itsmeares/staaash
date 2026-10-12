"use client";

import React, { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { startPath } from "@/lib/start-page";

import { useAdvanceOnInput } from "./use-advance-on-input";
import { useShake } from "./use-shake";
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

  useAdvanceOnInput(
    advanceToForm,
    phase === "intro" || phase === "intro-return",
  );

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
        const dest =
          mode === "signin" && next
            ? next
            : startPath(json.user?.preferences?.startPage);
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
            "mt-1 cursor-pointer rounded-xl border-0 bg-transparent p-0 text-meta text-muted-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary/55 disabled:cursor-default",
            styles.introHint,
          )}
          disabled={!isActive}
          onClick={advanceToForm}
          type="button"
        >
          Click anywhere or press any key
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

  const exiting = phase === "exiting-to-intro";

  if (mode === "signin") {
    return (
      <SignInForm
        error={error}
        exiting={exiting}
        firstFieldRef={firstFieldRef}
        instanceName={instanceName ?? "Staaash"}
        pending={pending}
        onSubmit={handleSubmit}
      />
    );
  }

  // Setup (including exiting-to-intro state)
  return (
    <div
      data-entry-form
      className={cn(
        "grid w-[min(100%,380px)] gap-0 rounded-3xl border border-border bg-card/88 p-6 shadow-dialog backdrop-blur-md",
        exiting ? styles.formExiting : styles.formEntering,
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
        <div className="grid gap-1.5">
          <label
            className="text-meta font-medium text-foreground/90"
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
            className="text-meta font-medium text-foreground/90"
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
            className="text-meta font-medium text-foreground/90"
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

        <Button className="mt-1.5 w-full" type="submit" disabled={pending}>
          {pending ? "Setting up…" : "Create owner and continue"}
        </Button>
      </form>
    </div>
  );
}

/**
 * No card: the drive's name and two fields straight on the halftone. A wrong
 * password shakes the field once, says so under it and clears it.
 */
function SignInForm({
  instanceName,
  error,
  pending,
  exiting,
  firstFieldRef,
  onSubmit,
}: {
  instanceName: string;
  error: string | null;
  pending: boolean;
  exiting: boolean;
  firstFieldRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);

  useShake(passwordRef, error);

  const field =
    "h-11 border-white/18 bg-black/30 text-base backdrop-blur-sm placeholder:text-white/40";

  return (
    <form
      data-entry-form
      className={cn(
        "grid w-[min(100%,340px)] gap-4",
        styles.readable,
        exiting ? styles.formExiting : styles.formEntering,
      )}
      onSubmit={onSubmit}
    >
      <h1 className="mb-3 text-center font-heading text-[clamp(2.25rem,6vw,3.25rem)] leading-none font-normal tracking-tight">
        {instanceName}
      </h1>
      <label
        className="grid gap-1.5 text-meta text-foreground/80"
        htmlFor="email"
      >
        Email
        <Input
          ref={firstFieldRef}
          autoComplete="email"
          className={field}
          id="email"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>
      <label
        className="grid gap-1.5 text-meta text-foreground/80"
        htmlFor="password"
      >
        Password
        <Input
          ref={passwordRef}
          aria-describedby={error ? "signin-error" : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="current-password"
          className={cn(field, error && "border-destructive/70")}
          id="password"
          name="password"
          required
          type="password"
        />
        {error ? (
          <span
            className="text-label text-destructive-foreground"
            id="signin-error"
            role="alert"
          >
            {error}
          </span>
        ) : null}
      </label>
      <Button className="mt-2 h-11 w-full" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
