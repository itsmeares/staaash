"use client";

import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

type SettingsPanelProps = {
  title: string;
  description: string;
  hidden?: boolean;
  id?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

// Panels stay mounted when closed so a form wrapping several panels still
// submits every field.
export function SettingsPanel({
  title,
  description,
  hidden = false,
  id,
  open,
  onOpenChange,
  children,
}: SettingsPanelProps) {
  return (
    <Collapsible
      hidden={hidden}
      id={id}
      open={open}
      onOpenChange={onOpenChange}
      className="overflow-hidden rounded-lg border border-line-strong bg-card/80 has-data-panel-open:border-foreground/20"
    >
      <CollapsibleTrigger className="group grid min-h-14.5 w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-0 bg-transparent px-3.5 py-3 text-left text-inherit transition-colors select-none hover:bg-hover motion-reduce:transition-none md:min-h-19 md:px-5 md:py-4.5">
        <span>
          <span className="block text-meta leading-tight font-semibold text-foreground">
            {title}
          </span>
          <span className="mt-1 block text-label leading-snug text-muted-foreground md:text-meta">
            {description}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4.5 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel keepMounted>
        <div className="grid gap-3.5 border-t border-hairline px-3.5 pb-3.5 md:gap-4.5 md:px-5 md:pb-5">
          {children}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function SettingsAccordion({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2.5" aria-label="Settings sections">
      {children}
    </div>
  );
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
      className="grid min-h-14 grid-cols-1 items-stretch gap-2 border-b border-hairline py-3 last:border-b-0 md:min-h-17.5 md:grid-cols-[minmax(0,1fr)_minmax(240px,300px)] md:items-center md:gap-6 md:py-4.5"
      hidden={hidden}
    >
      <LabelTag className="m-0 min-w-0 text-sm leading-snug font-medium text-foreground md:text-body">
        {label}
        {hint ? (
          <span className="mt-0.5 block text-xs leading-snug font-normal text-muted-foreground md:text-meta">
            {hint}
          </span>
        ) : null}
      </LabelTag>
      <ValueTag
        className={cn(
          "m-0 min-w-0",
          kind === "control"
            ? "flex w-full flex-wrap items-center justify-start gap-2 justify-self-end md:justify-end"
            : "text-sm leading-snug break-words text-foreground/80 md:text-right md:text-body",
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
