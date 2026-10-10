import Link from "next/link";

import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";

const CARD =
  "grid grid-cols-1 min-h-26 min-w-0 content-start gap-2 rounded-lg border border-hairline bg-card px-5 py-4.5 max-md:p-4";

export function AdminStatCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail?: string;
  href?: string;
}) {
  const content = (
    <>
      <SectionLabel>{label}</SectionLabel>
      <strong className="truncate font-heading text-3xl leading-none font-semibold text-foreground">
        {value}
      </strong>
      {detail ? (
        <small className="truncate text-meta text-muted-foreground">
          {detail}
        </small>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link
        className={cn(CARD, "hover:border-primary/24 hover:bg-primary/6")}
        href={href}
      >
        {content}
      </Link>
    );
  }

  return <article className={CARD}>{content}</article>;
}
