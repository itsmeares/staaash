import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";

const avatarVariants = cva(
  "flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-foreground select-none",
  {
    defaultVariants: { size: "default", variant: "accent" },
    variants: {
      size: {
        default: "size-8 text-label",
        lg: "size-8.5 text-meta",
      },
      variant: {
        accent: "bg-primary/14",
        neutral: "bg-foreground/8",
      },
    },
  },
);

export function Avatar({
  avatarUrl,
  initials,
  size,
  variant,
}: {
  avatarUrl: string | null;
  initials: string;
} & VariantProps<typeof avatarVariants>) {
  return (
    <AvatarPrimitive.Root
      key={avatarUrl}
      className={avatarVariants({ size, variant })}
    >
      <AvatarPrimitive.Image
        src={avatarUrl ?? undefined}
        alt=""
        className="size-full rounded-full object-cover"
      />
      <AvatarPrimitive.Fallback className="leading-none">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
