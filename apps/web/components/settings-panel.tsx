"use client";

import { SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

type SettingsPanelProps = {
  title: string;
  description?: string;
  hidden?: boolean;
  id?: string;
  children: ReactNode;
};

/** A plain settings section: a heading and its rows, no accordion. */
export function SettingsPanel({
  title,
  description,
  hidden = false,
  id,
  children,
}: SettingsPanelProps) {
  return (
    <section
      aria-labelledby={id ? `${id}-title` : undefined}
      className="grid gap-1"
      hidden={hidden}
      id={id}
    >
      <h2
        className="m-0 font-heading text-lg font-semibold"
        id={id ? `${id}-title` : undefined}
      >
        {title}
      </h2>
      {description ? (
        <p className="m-0 text-meta text-muted-foreground">{description}</p>
      ) : null}
      <div className="grid gap-3.5 pt-1">{children}</div>
    </section>
  );
}

export function SettingsAccordion({ children }: { children: ReactNode }) {
  return <div className="grid gap-9">{children}</div>;
}

type SettingsListProps = { plain?: boolean; children: ReactNode };

// `plain` renders a div for lists that are not definition lists.
export function SettingsList({ plain = false, children }: SettingsListProps) {
  const Tag = plain ? "div" : "dl";
  return <Tag className="m-0 grid gap-0 p-0">{children}</Tag>;
}

type SettingsRowProps = {
  label: ReactNode;
  hint?: ReactNode;
  hidden?: boolean;
  plain?: boolean;
  /** "value" renders read-only text, "control" renders form controls. */
  kind?: "control" | "value";
  children: ReactNode;
};

export function SettingsRow({
  label,
  hint,
  hidden,
  plain = false,
  kind = "control",
  children,
}: SettingsRowProps) {
  const LabelTag = plain ? "div" : "dt";
  const ValueTag = plain ? "div" : "dd";

  return (
    <div
      className="grid min-h-13 grid-cols-1 items-stretch gap-2 border-b border-border py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)] md:items-center md:gap-6"
      hidden={hidden}
    >
      <LabelTag className="m-0 min-w-0 text-body leading-snug font-medium text-foreground">
        {label}
        {hint ? (
          <span className="mt-0.5 block text-meta leading-snug font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </LabelTag>
      <ValueTag
        className={cn(
          "m-0 min-w-0",
          kind === "control"
            ? "flex w-full flex-wrap items-center justify-start gap-2 justify-self-end md:justify-end"
            : "text-body leading-snug break-words text-foreground/80 md:text-right",
        )}
      >
        {children}
      </ValueTag>
    </div>
  );
}

export function SettingsSearch(props: ComponentProps<typeof InputGroupInput>) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput size="lg" type="search" {...props} />
    </InputGroup>
  );
}

type FormStatusProps = { tone: "success" | "error"; children: ReactNode };

export function SettingsFormStatus({ tone, children }: FormStatusProps) {
  return (
    <p
      className={cn(
        "m-0 text-label leading-snug md:text-meta",
        tone === "success" ? "text-success-foreground" : "text-destructive",
      )}
    >
      {children}
    </p>
  );
}
