import { cn } from "@/lib/utils";

export function SkipLink({
  className,
  href = "#main-content",
  children = "Skip to content",
}: {
  className?: string;
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      className={cn(
        "fixed top-3 left-3 z-1000 -translate-y-[160%] rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-floating transition-transform duration-150 ease-out focus-visible:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring/70 motion-reduce:transition-none",
        className,
      )}
      href={href}
    >
      {children}
    </a>
  );
}
