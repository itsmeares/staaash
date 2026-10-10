import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "size-7", text: "text-label" },
  md: { box: "size-9 md:size-11", text: "text-label md:text-meta" },
  lg: { box: "size-12", text: "text-body" },
  xl: { box: "size-13.5", text: "text-xl" },
} as const;

export function AdminAvatar({
  avatarUrl,
  initials,
  size = "md",
  className,
}: {
  avatarUrl: string | null;
  initials: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/14 bg-primary/12",
        SIZES[size].box,
        className,
      )}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        <span
          className={cn(
            "font-heading leading-none font-semibold tracking-wide text-primary-ink select-none",
            SIZES[size].text,
          )}
        >
          {initials}
        </span>
      )}
    </span>
  );
}
