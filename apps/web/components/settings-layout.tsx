import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { useMediaQuery } from "@/src/workspace/use-media-query";
import { Button } from "@staaash/ui/components/button";
import { Input } from "@staaash/ui/components/input";
import { GlidingPill, useGlidingPill } from "@/components/gliding-pill";
import { cn } from "@staaash/ui/utils";

export type SettingsCategory = {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
  /** Has changes that aren't saved yet. */
  changed?: boolean;
  /** Puts this category back to its defaults; left out when it already is. */
  onReset?: () => void;
};

/** Unsaved changes: the bar under the categories saves or drops them. */
export type SettingsPending = {
  saving: boolean;
  onDiscard: () => void;
  /** Left out inside a form, where Save submits it. */
  onSave?: () => void;
};

/** Marks a setting or category with changes that aren't saved yet. */
export function ChangedDot() {
  return (
    <span
      aria-label="Changed"
      className="size-1.5 shrink-0 rounded-full bg-primary"
      role="img"
    />
  );
}

function SaveBar({ pending }: { pending: SettingsPending }) {
  return (
    <div className="sticky bottom-4 z-10 flex animate-in items-center gap-2 rounded-2xl border border-border bg-popover py-2 ps-4 pe-2 shadow-floating duration-200 ease-out fade-in slide-in-from-bottom-2 motion-reduce:animate-none max-sm:bottom-[calc(76px+env(safe-area-inset-bottom))] lg:col-start-2">
      <ChangedDot />
      <span className="flex-1 text-body font-medium">Unsaved changes</span>
      <Button
        disabled={pending.saving}
        size="sm"
        variant="ghost"
        onClick={pending.onDiscard}
      >
        Discard
      </Button>
      <Button
        disabled={pending.saving}
        size="sm"
        type={pending.onSave ? "button" : "submit"}
        onClick={pending.onSave}
      >
        {pending.saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

/**
 * Both Settings pages: an index on the left that switches categories, one
 * category at a time on the right. On phones the index is a list and each
 * category opens as its own page. Hidden categories stay mounted so their
 * fields remain in the surrounding form.
 */
// fallow-ignore-next-line complexity
export function SettingsLayout({
  categories,
  initial = null,
  pending = null,
}: {
  categories: SettingsCategory[];
  /** Category to open first, e.g. from a link to one setting. */
  initial?: string | null;
  pending?: SettingsPending | null;
}) {
  const wide = useMediaQuery("(min-width: 64rem)");
  const [open, setOpen] = useState<string | null>(
    categories.some((category) => category.id === initial) ? initial : null,
  );
  const current = open ?? (wide ? categories[0]?.id : null);
  const showIndex = wide || current === null;
  const { ref, pill } = useGlidingPill<HTMLElement>(`${current}:${wide}`);
  const dirty = pending !== null;

  // A reload or closed tab would drop the changes without a word.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[12.5rem_minmax(0,40rem)]">
      {showIndex ? (
        <nav
          aria-label="Settings"
          className={cn(
            "group/nav relative grid gap-px",
            !wide &&
              "animate-in overflow-hidden rounded-2xl border border-border duration-200 ease-out fade-in slide-in-from-left-3 motion-reduce:animate-none",
          )}
          data-ready={wide && pill ? "" : undefined}
          ref={ref}
        >
          {wide ? <GlidingPill pill={pill} /> : null}
          {categories.map(({ id, label, icon: Icon, changed }) => (
            <button
              aria-current={id === current ? "page" : undefined}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 text-left text-body outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
                wide
                  ? "relative h-9 rounded-lg px-2.5 text-muted-foreground transition-colors duration-150 hover:bg-hover hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:not-group-data-ready/nav:selected-pill aria-[current=page]:hover:bg-transparent motion-reduce:transition-none aria-[current=page]:[&_svg]:text-primary"
                  : "min-h-13 border-t border-border px-4 first:border-t-0 hover:bg-hover [&_svg]:text-muted-foreground",
              )}
              key={id}
              type="button"
              onClick={() => setOpen(id)}
            >
              <Icon aria-hidden />
              <span className="flex-1">{label}</span>
              {changed ? <ChangedDot /> : null}
              {wide ? null : <ChevronRight aria-hidden />}
            </button>
          ))}
        </nav>
      ) : null}
      <div className={cn(!wide && current === null && "hidden")}>
        {categories.map(({ id, label, content, onReset }) => (
          <section
            aria-label={label}
            className={cn(
              "grid animate-in gap-3.5 duration-200 ease-out fade-in slide-in-from-bottom-1 motion-reduce:animate-none",
              !wide && "slide-in-from-bottom-0 slide-in-from-right-3",
              id !== current && "hidden",
            )}
            key={id}
          >
            <div className="flex items-center gap-1">
              {wide ? null : (
                <Button
                  aria-label="Back to Settings"
                  className="-ms-2"
                  size="icon-sm"
                  variant="ghost-muted"
                  onClick={() => setOpen(null)}
                >
                  <ChevronLeft aria-hidden />
                </Button>
              )}
              <h2 className="m-0 flex-1 font-heading text-lg font-semibold">
                {label}
              </h2>
              {onReset ? (
                <Button size="sm" variant="ghost-muted" onClick={onReset}>
                  <RotateCcw aria-hidden />
                  Reset to defaults
                </Button>
              ) : null}
            </div>
            {content}
          </section>
        ))}
      </div>
      {pending ? <SaveBar pending={pending} /> : null}
    </div>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {children}
    </div>
  );
}

/** A named group of cards inside a category, with an action beside the name. */
export function SettingsGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-2.5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="m-0 font-sans text-label font-medium text-muted-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A label on the left and one control in the shared 200px column. */
export function SettingsRow({
  label,
  hint,
  error,
  htmlFor,
  changed,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  changed?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="grid min-h-14 items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_12.5rem]">
      <div className="grid min-w-0 gap-0.5">
        <span className="flex items-center gap-2">
          <label className="text-body font-medium" htmlFor={htmlFor}>
            {label}
          </label>
          {changed ? <ChangedDot /> : null}
        </span>
        {hint ? (
          <span className="text-label text-muted-foreground">{hint}</span>
        ) : null}
        {error ? (
          <span className="text-label text-destructive-foreground" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      {children ? (
        <div className="flex min-w-0 sm:justify-end">{children}</div>
      ) : null}
    </div>
  );
}

/** A plain text field sized to the shared control column. */
export function SettingsText(props: ComponentProps<typeof Input>) {
  return <Input className="w-full sm:w-50" size="sm" {...props} />;
}
