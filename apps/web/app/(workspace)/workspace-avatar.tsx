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
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/14",
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
        <span className="text-label leading-none font-semibold text-foreground select-none">
          {initials}
        </span>
      )}
    </span>
  );
}
