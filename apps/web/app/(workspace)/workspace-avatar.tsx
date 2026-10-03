import { cn } from "@/lib/utils";

export function WorkspaceAvatar({
  avatarUrl,
  initials,
  className,
}: {
  avatarUrl: string | null;
  initials: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/15 bg-primary/12",
        className,
      )}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span className="font-heading text-xs leading-none font-semibold tracking-wide text-primary-ink select-none lg:text-meta">
          {initials}
        </span>
      )}
    </span>
  );
}
