"use client";

import React, { useEffect, useRef, useState } from "react";

import { raiseCurtain } from "@/components/curtain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startPath } from "@/lib/start-page";
import { applyTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { EntryShell } from "./entry-shell";
import styles from "./entry-experience.module.css";
import { useAdvanceOnInput } from "./use-advance-on-input";
import { useShake } from "./use-shake";

type SignInResponse = {
  error?: string;
  user?: {
    preferences?: {
      theme?: Theme;
      startPage?: string;
      onboardingCompletedAt?: string | null;
    } | null;
  };
};

/** After signing in: finish setup at "/", or slide into the drive. */
function enterDrive(json: SignInResponse, next: string | undefined) {
  const prefs = json.user?.preferences;
  if (!prefs?.onboardingCompletedAt) {
    window.location.assign("/");
    return;
  }
  applyTheme(prefs.theme ?? "system");
  raiseCurtain("Welcome back.", next ?? startPath(prefs.startPage), 900);
}

/**
 * The drive's name, then two fields straight on the halftone. A wrong
 * password shakes the field once, says so under it and clears it.
 */
export function SignIn({
  instanceName = "Staaash",
  next,
}: {
  instanceName?: string;
  next?: string;
}) {
  const [phase, setPhase] = useState<"intro" | "leaving" | "form">("intro");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useAdvanceOnInput(() => {
    setPhase("leaving");
    setTimeout(() => setPhase("form"), 360);
  }, phase === "intro");
  useShake(passwordRef, error);

  useEffect(() => {
    if (phase === "form") emailRef.current?.focus();
  }, [phase]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      });
      const json = (await response.json()) as SignInResponse;
      if (!response.ok) {
        setError(json.error ?? "Something went wrong. Try again.");
        setPending(false);
        return;
      }
      enterDrive(json, next);
    } catch {
      setError("Network error. Try again.");
      setPending(false);
    }
  }

  return (
    <EntryShell showBrand={false}>
      {phase !== "form" ? (
        <section
          className={cn(
            "grid max-w-[clamp(22rem,50vw,44rem)] cursor-default gap-4 text-center select-none md:gap-5",
            styles.readable,
            phase === "leaving" && styles.introExiting,
          )}
        >
          <h1
            className={cn(
              "font-heading text-display tracking-tighter text-foreground",
              styles.introTitle,
            )}
          >
            {instanceName}
          </h1>
          <button
            className={cn(
              "cursor-pointer rounded-xl border-0 bg-transparent p-0 text-meta text-foreground/80 outline-none focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-primary/55",
              styles.introHint,
            )}
            type="button"
          >
            Click anywhere or press any key
          </button>
        </section>
      ) : (
        <SignInForm
          emailRef={emailRef}
          error={error}
          instanceName={instanceName}
          passwordRef={passwordRef}
          pending={pending}
          onSubmit={handleSubmit}
        />
      )}
    </EntryShell>
  );
}

const field =
  "h-11 border-white/18 bg-black/30 text-base backdrop-blur-sm placeholder:text-white/40";

function SignInForm({
  instanceName,
  error,
  pending,
  emailRef,
  passwordRef,
  onSubmit,
}: {
  instanceName: string;
  error: string | null;
  pending: boolean;
  emailRef: React.RefObject<HTMLInputElement | null>;
  passwordRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      data-entry-form
      className={cn(
        "grid w-[min(100%,340px)] gap-4",
        styles.readable,
        styles.formEntering,
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
          ref={emailRef}
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
