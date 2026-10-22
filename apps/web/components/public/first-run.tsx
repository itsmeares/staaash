"use client";

import React, { useEffect, useRef, useState } from "react";
import { AUTO_TIME_ZONE, getBrowserTimeZone } from "@staaash/config/time-zone";

import { saveOwnerOnboardingSettings } from "@/app/(workspace)/admin/settings/actions";
import { raiseCurtain } from "@/components/curtain";
import { DriveGlyph } from "@/components/drive-glyph";
import { MiniDrive } from "@/components/mini-drive";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { startPath } from "@/lib/start-page";
import { applyTheme } from "@/lib/theme";
import { cn } from "@staaash/ui/utils";

import { EntryBackground } from "./entry-background";
import styles from "./first-run.module.css";
import { useAdvanceOnInput } from "./use-advance-on-input";

type StepId =
  | "intro"
  | "drive"
  | "account"
  | "password"
  | "look"
  | "time"
  | "name"
  | "choices";

/** Who is arriving decides the steps. */
export type FirstRunKind =
  | "owner-setup"
  | "owner"
  | "member"
  | "member-password"
  | "password";

const STEPS: Record<FirstRunKind, StepId[]> = {
  "owner-setup": [
    "intro",
    "drive",
    "account",
    "look",
    "time",
    "name",
    "choices",
  ],
  owner: ["look", "time", "name", "choices"],
  member: ["intro", "look", "time", "name"],
  "member-password": ["intro", "password", "look", "time", "name"],
  password: ["password"],
};

const LABELS: Record<StepId, string> = {
  intro: "",
  drive: "Drive",
  account: "Account",
  password: "Password",
  look: "Look",
  time: "Time",
  name: "Name",
  choices: "Choices",
};

// For screen readers and tests; the page itself is the sentence.
const HEADINGS: Record<StepId, string> = {
  intro: "Welcome",
  drive: "Name your drive",
  account: "Create your account",
  password: "Choose a new password",
  look: "Choose a look",
  time: "Check your time",
  name: "Your name",
  choices: "A few choices",
};

const VERSIONS = ["once an hour", "never"] as const;
const PREVIEWS = [
  "when a video is first opened",
  "as soon as it's uploaded",
  "never",
] as const;

const post = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
};

const cityOf = (zone: string) =>
  (zone.split("/").pop() ?? zone).replaceAll("_", " ");

function Clock({ zone }: { zone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span
      className={cn(styles.clock, styles.readable)}
      suppressHydrationWarning
    >
      {new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: zone,
      }).format(now)}
    </span>
  );
}

function Flip<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <button
      aria-label={`${label}: ${value}`}
      className={styles.flip}
      type="button"
      onClick={() =>
        onChange(options[(options.indexOf(value) + 1) % options.length]!)
      }
    >
      {value}
    </button>
  );
}

type Previews = {
  enabled: boolean;
  onUpload: boolean;
  onFirstView: boolean;
  onShare: boolean;
};

type Choice = {
  versions: (typeof VERSIONS)[number];
  previews: (typeof PREVIEWS)[number];
};

const previewChoice = (initial: Previews): Choice["previews"] =>
  !initial.enabled
    ? "never"
    : initial.onUpload
      ? "as soon as it's uploaded"
      : "when a video is first opened";

const isOwnerKind = (kind: FirstRunKind) =>
  kind === "owner-setup" || kind === "owner";

/** The owner's two choices, in the drive's own settings. */
const ownerSettings = (
  values: Choice & { zone: string },
  initial: Previews,
) => {
  const previews = values.previews !== "never";
  return {
    mediaPreviewEnabled: previews,
    mediaPreviewGenerateOnUpload:
      values.previews === "as soon as it's uploaded",
    mediaPreviewGenerateOnFirstView: previews || initial.onFirstView,
    mediaPreviewGenerateOnShare: initial.onShare,
    updateCheckEnabled: values.versions !== "never",
    // The drive's own schedule needs a fixed zone, not "follow me".
    timeZone:
      values.zone === AUTO_TIME_ZONE ? getBrowserTimeZone() : values.zone,
  };
};

/** The last step: save everything, then reveal the drive. */
// Each branch is one saved choice; the order is the order they're saved in.
// fallow-ignore-next-line complexity
async function saveFirstRun(
  kind: FirstRunKind,
  values: Choice & {
    theme: "dark" | "light" | null;
    zone: string;
    name: string;
  },
  initial: Previews,
) {
  const theme = values.theme ?? "system";
  if (isOwnerKind(kind)) {
    const result = await saveOwnerOnboardingSettings(
      ownerSettings(values, initial),
    );
    if (result?.error) throw new Error(result.error);
  }
  await post("/api/user/preferences", {
    theme,
    timeZone: values.zone,
    displayName: values.name.trim() || null,
    ...(isOwnerKind(kind)
      ? { showUpdateNotifications: values.versions !== "never" }
      : {}),
  });
  applyTheme(theme);
  const first = values.name.trim().split(/\s+/)[0];
  // A new account opens on the default start page.
  raiseCurtain(first ? `Hi, ${first}.` : "Hi.", startPath(null), 2000);
}

function IntroScreen({
  kind,
  instanceName,
}: {
  kind: FirstRunKind;
  instanceName: string;
}) {
  return (
    <div className="grid gap-5">
      <p className={cn(styles.display, styles.readable)}>
        {kind === "owner-setup" ? (
          <>
            Bring your Staaash
            <br />
            online.
          </>
        ) : (
          <>
            Let&apos;s set up your
            <br />
            {instanceName} account.
          </>
        )}
      </p>
      <p className={styles.hint}>Click anywhere or press any key</p>
    </div>
  );
}

/** "Call me [your name]": one field inside a sentence. */
function SentenceField({
  lead,
  small = false,
  wide = false,
  ...input
}: React.ComponentProps<"input"> & {
  lead: string;
  small?: boolean;
  wide?: boolean;
}) {
  return (
    <label
      className={cn(styles.sentence, small && styles.small, styles.readable)}
    >
      <span>{lead}</span>
      <input className={cn(styles.field, wide && styles.wide)} {...input} />
    </label>
  );
}

function AccountScreen({
  email,
  password,
  onEmail,
  onPassword,
}: {
  email: string;
  password: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
}) {
  return (
    <div className={cn(styles.sentence, styles.small, styles.readable)}>
      <span>I sign in as</span>
      <input
        aria-label="Email"
        autoComplete="email"
        className={cn(styles.field, styles.wide)}
        placeholder="email"
        type="email"
        value={email}
        onChange={(event) => onEmail(event.target.value)}
      />
      <span>with</span>
      <input
        aria-label="Password"
        autoComplete="new-password"
        className={cn(styles.field, styles.wide)}
        minLength={12}
        placeholder="a password"
        type="password"
        value={password}
        onChange={(event) => onPassword(event.target.value)}
      />
    </div>
  );
}

function LookScreen({
  theme,
  onPick,
}: {
  theme: "dark" | "light" | null;
  onPick: (theme: "dark" | "light") => void;
}) {
  return (
    <div aria-label="Look" className={styles.halves} role="radiogroup">
      {(["dark", "light"] as const).map((option) => (
        <button
          aria-checked={theme === option}
          className={styles.half}
          data-theme={option}
          key={option}
          role="radio"
          type="button"
          onClick={() => onPick(option)}
        >
          <span aria-hidden className={styles.check}>
            ✓
          </span>
          <MiniDrive className={styles.mini} theme={option} />
          <span className={styles.halfName}>
            {option === "dark" ? "Dark" : "Light"}
          </span>
        </button>
      ))}
    </div>
  );
}

function TimeScreen({
  zone,
  onZone,
}: {
  zone: string;
  onZone: (zone: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const shown = zone === AUTO_TIME_ZONE ? getBrowserTimeZone() : zone;
  return (
    <div className="grid justify-items-center gap-2">
      <Clock zone={shown} />
      <span className={cn("text-lg", styles.readable)}>
        {cityOf(shown)} ·{" "}
        <button
          className="cursor-pointer underline underline-offset-4"
          type="button"
          onClick={() => setChanging((open) => !open)}
        >
          change
        </button>
      </span>
      {changing ? (
        <div className="mt-3 w-72 text-start">
          <TimeZonePicker
            allowAuto
            value={zone}
            onChange={(next) => {
              onZone(next);
              setChanging(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ChoicesScreen({
  choice,
  onChoice,
}: {
  choice: Choice;
  onChoice: (choice: Choice) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <p className={cn(styles.choices, styles.readable)}>
      Check for new versions{" "}
      <Flip
        label="Check for new versions"
        options={VERSIONS}
        value={choice.versions}
        onChange={(versions) => onChoice({ ...choice, versions })}
      />
      , and make video previews{" "}
      <Flip
        label="Make video previews"
        options={PREVIEWS}
        value={choice.previews}
        onChange={(previews) => onChoice({ ...choice, previews })}
      />
      <span className="whitespace-nowrap">
        {choice.previews === "never" ? null : (
          <button
            aria-expanded={infoOpen}
            aria-label="About previews"
            className={styles.info}
            type="button"
            onClick={() => setInfoOpen((open) => !open)}
          >
            i
            <span className={styles.tip} role="tooltip">
              Making previews takes a lot of processing power. How fast it goes
              depends on your server.
            </span>
          </button>
        )}
        .
      </span>
    </p>
  );
}

/** Progress at the top; done steps above the floor can be clicked. */
function StepDots({
  steps,
  index,
  floor,
  reached,
  onGo,
}: {
  steps: StepId[];
  index: number;
  floor: number;
  reached: number;
  onGo: (index: number) => void;
}) {
  const shown = steps.filter((id) => id !== "intro");
  if (steps[index] === "intro" || shown.length < 2) return null;
  return (
    <nav aria-label="Steps" className={styles.dots}>
      {shown.map((id) => {
        const at = steps.indexOf(id);
        const reach = at >= floor && at <= reached && at !== index;
        return (
          <button
            aria-current={at === index ? "step" : undefined}
            aria-label={LABELS[id]}
            className={styles.dot}
            data-label={LABELS[id]}
            data-on={at <= index ? "" : undefined}
            data-reach={reach ? "" : undefined}
            disabled={!reach}
            key={id}
            type="button"
            onClick={() => onGo(at)}
          />
        );
      })}
    </nav>
  );
}

type KeyAction = "dark" | "light" | "back" | "next";
const LOOK_KEYS: Record<string, KeyAction> = {
  ArrowLeft: "dark",
  ArrowRight: "light",
  Escape: "back",
};
const FORM_KEYS: Record<string, KeyAction> = { Escape: "back", Enter: "next" };

/** ← and → pick a theme, Esc goes back, Enter continues. */
function useStepKeys(
  step: StepId,
  on: {
    pick: (theme: "dark" | "light") => void;
    back: () => void;
    next: () => void;
  },
) {
  useEffect(() => {
    // Guard clauses for keys the step doesn't use; the work is the table.
    // fallow-ignore-next-line complexity
    const onKey = (event: KeyboardEvent) => {
      // The intro's own "any key" handler already used this one.
      if (event.defaultPrevented || step === "intro") return;
      const action = (step === "look" ? LOOK_KEYS : FORM_KEYS)[event.key];
      // A focused button handles its own Enter.
      if (
        !action ||
        (action === "next" && event.target instanceof HTMLButtonElement)
      ) {
        return;
      }
      event.preventDefault();
      if (action === "dark" || action === "light") on.pick(action);
      else on[action]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}

const goLabel = (step: StepId, isLast: boolean) =>
  step === "account"
    ? "Create account"
    : step === "time"
      ? "That's my time"
      : isLast
        ? "Finish"
        : "Continue";

/**
 * Setting up the drive, or an account on it, as a few sentences on the
 * halftone. Each step saves what it must; the last one reveals the drive.
 */
// The flow's state lives here so every screen above can stay dumb.
// fallow-ignore-next-line complexity
export function FirstRun({
  kind,
  instanceName,
  displayName,
  initialPreviews = {
    enabled: true,
    onUpload: false,
    onFirstView: true,
    onShare: true,
  },
}: {
  kind: FirstRunKind;
  instanceName: string;
  displayName?: string | null;
  initialPreviews?: Previews;
}) {
  const steps = STEPS[kind];
  const [index, setIndex] = useState(0);
  const [reached, setReached] = useState(0);
  // The lowest step Back can reach: never the intro, and nothing before a
  // saved account or password, which can't be redone from here.
  const [floor, setFloor] = useState(steps[0] === "intro" ? 1 : 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drive, setDrive] = useState(
    kind === "owner-setup" ? "" : instanceName,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);
  const [zone, setZone] = useState(AUTO_TIME_ZONE);
  const [name, setName] = useState(displayName ?? "");
  const [choice, setChoice] = useState<Choice>(() => ({
    versions: VERSIONS[0],
    previews: previewChoice(initialPreviews),
  }));
  const frame = useRef<HTMLElement>(null);

  const step = steps[index]!;
  const isLast = index === steps.length - 1;

  const go = (next: number) => {
    if (next < floor || next >= steps.length) return;
    setError(null);
    setIndex(next);
    setReached((value) => Math.max(value, next));
  };

  // What a step must save before the next one shows.
  const saveStep = async () => {
    if (step === "drive" && !drive.trim()) {
      throw new Error("Give your drive a name.");
    }
    if (step === "account") {
      await post("/api/auth/setup", {
        instanceName: drive.trim(),
        email,
        password,
      });
      setFloor(index + 1);
    }
    if (step === "password") {
      await post("/api/auth/password-change-required", {
        password: newPassword,
        confirmPassword: newPassword,
      });
      setFloor(index + 1);
    }
  };

  const complete = () =>
    kind === "password"
      ? // Only the password changed; everything else is already set.
        window.location.assign("/api/auth/rehydrate")
      : saveFirstRun(kind, { ...choice, theme, zone, name }, initialPreviews);

  const advance = async () => {
    if (pending || (step === "look" && !theme)) return;
    setError(null);
    setPending(true);
    try {
      await saveStep();
      if (isLast) await complete();
      else go(index + 1);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong.",
      );
    } finally {
      setPending(false);
    }
  };

  const pick = (next: "dark" | "light") => {
    setTheme(next);
    // A short beat so the check shows before the page moves on.
    setTimeout(() => go(index + 1), 420);
  };

  useAdvanceOnInput(() => go(index + 1), step === "intro");

  useEffect(() => {
    frame.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [index]);

  useStepKeys(step, {
    pick,
    back: () => go(index - 1),
    next: () => void advance(),
  });

  const screens: Record<StepId, React.ReactNode> = {
    intro: <IntroScreen instanceName={instanceName} kind={kind} />,
    drive: (
      <SentenceField
        autoComplete="off"
        lead="This is"
        maxLength={80}
        placeholder="your drive"
        value={drive}
        wide
        onChange={(event) => setDrive(event.target.value)}
      />
    ),
    account: (
      <AccountScreen
        email={email}
        password={password}
        onEmail={setEmail}
        onPassword={setPassword}
      />
    ),
    password: (
      <SentenceField
        autoComplete="new-password"
        lead="I'll sign in with"
        minLength={12}
        placeholder="a new password"
        small
        type="password"
        value={newPassword}
        wide
        onChange={(event) => setNewPassword(event.target.value)}
      />
    ),
    look: <LookScreen theme={theme} onPick={pick} />,
    time: <TimeScreen zone={zone} onZone={setZone} />,
    name: (
      <SentenceField
        autoComplete="name"
        lead="Call me"
        maxLength={80}
        placeholder="your name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    ),
    choices: <ChoicesScreen choice={choice} onChoice={setChoice} />,
  };

  return (
    <main
      className={cn("dark", styles.frame)}
      data-step={step}
      id="main-content"
      ref={frame}
    >
      <div aria-hidden className="absolute inset-0 -z-10">
        <EntryBackground />
        <div className={styles.shade} />
      </div>

      <div className={cn(styles.brand, styles.readable)}>
        <DriveGlyph className="w-7" />
        {drive.trim() || "Staaash"}
      </div>

      <StepDots
        floor={floor}
        index={index}
        reached={reached}
        steps={steps}
        onGo={go}
      />

      <section
        aria-labelledby="first-run-heading"
        className={styles.step}
        key={step}
      >
        <h1 className="sr-only" id="first-run-heading">
          {HEADINGS[step]}
        </h1>
        {screens[step]}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {step === "intro" || step === "look" ? null : (
        <div className={styles.nav}>
          {index > floor ? (
            <button
              className={styles.back}
              type="button"
              onClick={() => go(index - 1)}
            >
              Back
            </button>
          ) : null}
          <button
            className={styles.go}
            disabled={pending}
            type="button"
            onClick={() => void advance()}
          >
            {goLabel(step, isLast)}
          </button>
        </div>
      )}
    </main>
  );
}
