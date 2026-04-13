"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Phase = "intro" | "transitioning" | "form";

type SetupExperienceProps = {
  title: string;
  description: string;
};

export function SetupExperience({ title, description }: SetupExperienceProps) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Click-anywhere handler — active only during intro phase
  useEffect(() => {
    if (phase !== "intro") return;

    const advance = () => {
      setPhase("transitioning");
      setTimeout(() => setPhase("form"), 380);
    };

    document.addEventListener("click", advance);
    return () => {
      document.removeEventListener("click", advance);
    };
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
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (res.ok) {
        router.push("/library");
      } else {
        setError(json.error ?? "Something went wrong. Please try again.");
        setPending(false);
      }
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  return (
    <>
      {/* Intro — visible during 'intro' and 'transitioning' phases */}
      {phase !== "form" && (
        <section
          className={`setup-gateway${phase === "transitioning" ? " setup-gateway--exiting" : ""}`}
          tabIndex={phase === "intro" ? 0 : -1}
          aria-label="First launch — click anywhere or press Enter to begin setup"
          onKeyDown={(e) => {
            if (phase === "intro" && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              setPhase("transitioning");
              setTimeout(() => setPhase("form"), 380);
            }
          }}
        >
          <h1 className="setup-gateway__title font-heading text-[clamp(4rem,9vw,8rem)] leading-[0.92] tracking-[-0.06em] text-foreground">
            {title}
          </h1>
          <p className="setup-gateway__description text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {description}
          </p>
          <p className="setup-gateway__hint" aria-hidden="true">
            Click anywhere to begin
          </p>
        </section>
      )}

      {/* Form — visible only during 'form' phase */}
      {phase === "form" && (
        <div className="setup-form setup-form--entering">
          <Card className="border border-border/70 bg-card/88 shadow-[0_26px_80px_rgba(3,11,16,0.28)]">
            <CardHeader>
              <CardTitle>Set up Staaash</CardTitle>
              <CardDescription>
                Creates the instance record, the first owner account, and your
                initial session. Runs once — the setup endpoint closes after
                this completes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-5">
                {error && (
                  <p className="setup-form__error" role="alert">
                    {error}
                  </p>
                )}

                <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                  <FieldGroup className="gap-5">
                    <Field>
                      <FieldLabel htmlFor="instanceName">
                        Instance name
                      </FieldLabel>
                      <Input
                        ref={firstFieldRef}
                        id="instanceName"
                        name="instanceName"
                        placeholder="Staaash Home Drive"
                        required
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="username">Owner username</FieldLabel>
                      <Input
                        autoComplete="username"
                        id="username"
                        maxLength={32}
                        minLength={3}
                        name="username"
                        pattern="^(?!-)(?!.*--)[a-z0-9-]{3,32}(?<!-)$"
                        placeholder="johnsmith"
                        required
                      />
                      <FieldDescription>
                        Lowercase letters, numbers, and single hyphens only.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="displayName">
                        Display name
                      </FieldLabel>
                      <Input
                        id="displayName"
                        name="displayName"
                        placeholder="Instance owner"
                      />
                      <FieldDescription>
                        Presentation only. Does not affect the on-disk path.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        autoComplete="email"
                        id="email"
                        name="email"
                        required
                        type="email"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Input
                        autoComplete="new-password"
                        id="password"
                        minLength={12}
                        name="password"
                        required
                        type="password"
                      />
                      <FieldDescription>
                        At least 12 characters. Sessions stay server-side.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>

                  <Button
                    className="w-full"
                    disabled={pending}
                    size="lg"
                    type="submit"
                  >
                    {pending ? "Setting up…" : "Create owner and continue"}
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
