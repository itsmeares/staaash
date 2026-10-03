"use client";

import React, { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import styles from "./entry-experience.module.css";

export function PasswordChangeExperience() {
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = Object.fromEntries(new FormData(event.currentTarget));

    try {
      const response = await fetch("/api/auth/password-change-required", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      });
      const body = (await response.json()) as {
        error?: string;
        onboardingCompleted?: boolean;
      };

      if (!response.ok) {
        setError(body.error ?? "Unable to change password.");
        setPending(false);
        return;
      }

      window.location.assign(
        body.onboardingCompleted ? "/api/auth/rehydrate" : "/",
      );
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className={`grid w-[min(100%,380px)] gap-0 ${styles.formEntering}`}>
      <div className="mb-4.5 grid gap-4.5">
        <h1 className="font-heading">Change your password.</h1>
        <p className="text-xs leading-normal text-muted-foreground">
          Your password was reset. Choose a new password before continuing.
        </p>
      </div>

      {error ? (
        <p
          className="mb-3.5 text-center text-label leading-normal text-destructive-foreground"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <form className="grid gap-4.5" onSubmit={handleSubmit}>
        <div className="grid gap-1.5">
          <label
            className="text-xs font-medium tracking-wide text-muted-foreground"
            htmlFor="password"
          >
            Password
          </label>
          <Input
            ref={firstFieldRef}
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

        <div className="grid gap-1.5">
          <label
            className="text-xs font-medium tracking-wide text-muted-foreground"
            htmlFor="confirmPassword"
          >
            Confirm password
          </label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </div>

        <Button className="mt-1.5 w-full" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
