"use client";

import React, { useEffect, useRef, useState } from "react";

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
    <div className="entry-form entry-form--entering">
      <div className="entry-form__fields" style={{ marginBottom: "18px" }}>
        <h1 className="entry-form__title">Change your password.</h1>
        <p className="entry-form__help">
          Your password was reset. Choose a new password before continuing.
        </p>
      </div>

      {error ? (
        <p className="entry-form__error" role="alert">
          {error}
        </p>
      ) : null}

      <form className="entry-form__fields" onSubmit={handleSubmit}>
        <div className="entry-form__field">
          <label className="entry-form__label" htmlFor="password">
            Password
          </label>
          <input
            ref={firstFieldRef}
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

        <div className="entry-form__field">
          <label className="entry-form__label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            className="entry-form__input"
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </div>

        <button className="entry-form__submit" type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save new password"}
        </button>
      </form>
    </div>
  );
}
