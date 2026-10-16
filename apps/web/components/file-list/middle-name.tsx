import { cn } from "@/lib/utils";

import { splitName } from "./list-model";

/** Name that keeps its end visible when cut short. */
export function MiddleName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const { head, tail } = splitName(name);
  return (
    <span className={cn("flex min-w-0", className)} title={name}>
      {/* Screen readers get the whole name once, not two halves. */}
      <span className="sr-only">{name}</span>
      {/* Pre keeps a space at the cut, which nowrap would drop. */}
      <span aria-hidden className="truncate whitespace-pre">
        {head}
      </span>
      {tail ? (
        <span aria-hidden className="shrink-0 whitespace-pre">
          {tail}
        </span>
      ) : null}
    </span>
  );
}
