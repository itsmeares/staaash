import { appPath } from "@/lib/app-path";
import React, { useEffect, useRef, useState } from "react";

import { raiseCurtain } from "@/components/curtain";
import { Button } from "@staaash/ui/components/button";
import { Input } from "@staaash/ui/components/input";
import { Separator } from "@staaash/ui/components/separator";
import { demoAccount, isDemo } from "@/lib/demo";
import { startPath } from "@/lib/start-page";
import { applyTheme, type Theme } from "@/lib/theme";
import { cn } from "@staaash/ui/utils";

import { EntryShell } from "./entry-shell";
import styles from "./entry-experience.module.css";
import { useAdvanceOnInput } from "./use-advance-on-input";
import { useShake } from "./use-shake";

// The demo's fields come filled in, so a visitor enters with one click.
const fill = isDemo ? demoAccount : { email: "", password: "" };
const submitLabel = isDemo ? "Enter demo" : "Sign in";

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
    // A page behind sign-in sends an unfinished account back to "/" with
    // its address kept, so setup can return there.
    window.location.assign(appPath(next ?? "/"));
    return;
  }
  applyTheme(prefs.theme ?? "system");
  raiseCurtain("Welcome back.", next ?? startPath(prefs.startPage), 900);
}

/** Single sign-on, when the server has it set up. */
type Sso = { name: string; passwordLogin: boolean };

/**
 * The drive's name, then two fields straight on the halftone. A wrong
 * password shakes the field once, says so under it and clears it. With
 * single sign-on, its button sits under the fields, or alone when
 * passwords are off.
 */
export function SignIn({
  instanceName = "Staaash",
  next,
  sso = null,
  initialError,
}: {
  instanceName?: string;
  next?: string;
  sso?: Sso | null;
  /** A reason from the single sign-on trip, such as no account. */
  initialError?: string;
}) {
  const [phase, setPhase] = useState<"intro" | "leaving" | "form">(
    isDemo || initialError ? "form" : "intro",
  );
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
        <SignInIntro
          instanceName={instanceName}
          leaving={phase === "leaving"}
        />
      ) : sso && !sso.passwordLogin ? (
        <SsoOnly
          error={initialError}
          instanceName={instanceName}
          next={next}
          sso={sso}
        />
      ) : (
        <SignInForm
          emailRef={emailRef}
          error={error}
          instanceName={instanceName}
          next={next}
          passwordRef={passwordRef}
          pending={pending}
          sso={sso}
          ssoError={initialError}
          onSubmit={handleSubmit}
        />
      )}
    </EntryShell>
  );
}

function SignInIntro({
  instanceName,
  leaving,
}: {
  instanceName: string;
  leaving: boolean;
}) {
  return (
    <section
      className={cn(
        "grid max-w-[clamp(22rem,50vw,44rem)] cursor-default gap-4 text-center select-none md:gap-5",
        styles.readable,
        leaving && styles.introExiting,
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
  );
}

const demoNote = isDemo ? (
  <p className="m-0 text-center text-label text-foreground/80">
    Everything you do here stays in your browser.
  </p>
) : null;

const field =
  "border-white/18 bg-black/30 backdrop-blur-sm placeholder:text-white/40";

const ssoHref = (next: string | undefined) =>
  appPath(
    `/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  );

/** The provider's button, with why the last trip there failed under it. */
function SsoButton({
  sso,
  next,
  primary,
  error,
}: {
  sso: Sso;
  next: string | undefined;
  primary?: boolean;
  error?: string;
}) {
  return (
    <>
      <Button
        className="w-full"
        render={<a href={ssoHref(next)} />}
        size="lg"
        variant={primary ? "default" : "outline"}
      >
        Sign in with {sso.name}
      </Button>
      {error ? (
        <span
          className="text-center text-label text-destructive-foreground"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </>
  );
}

function SsoOnly({
  instanceName,
  sso,
  next,
  error,
}: {
  instanceName: string;
  sso: Sso;
  next: string | undefined;
  error?: string;
}) {
  return (
    <div
      data-entry-form
      className={cn(
        "grid w-[min(100%,340px)] gap-4",
        styles.readable,
        styles.formEntering,
      )}
    >
      <h1 className="mb-3 text-center font-heading text-[clamp(2.25rem,6vw,3.25rem)] leading-none font-normal tracking-tight">
        {instanceName}
      </h1>
      <SsoButton error={error} next={next} primary sso={sso} />
    </div>
  );
}

function SignInForm({
  instanceName,
  error,
  pending,
  emailRef,
  passwordRef,
  sso,
  ssoError,
  next,
  onSubmit,
}: {
  instanceName: string;
  error: string | null;
  pending: boolean;
  sso: Sso | null;
  ssoError?: string;
  next: string | undefined;
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
          size="lg"
          autoComplete="email"
          className={field}
          defaultValue={fill.email}
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
          size="lg"
          aria-describedby={error ? "signin-error" : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="current-password"
          className={cn(field, error && "border-destructive/70")}
          defaultValue={fill.password}
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
      <Button
        className="mt-2 w-full"
        disabled={pending}
        size="lg"
        type="submit"
      >
        {pending ? "Signing in…" : submitLabel}
      </Button>
      {sso ? (
        <>
          <div className="flex items-center gap-3 text-label text-foreground/80">
            <Separator className="flex-1 bg-white/18" />
            or
            <Separator className="flex-1 bg-white/18" />
          </div>
          <SsoButton error={ssoError} next={next} sso={sso} />
        </>
      ) : null}
      {demoNote}
    </form>
  );
}
