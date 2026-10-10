import { cn } from "@/lib/utils";

/** The drive mark from design/App/Staaash App Icon.svg, without the tile. */
export function DriveGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("h-auto w-6 shrink-0", className)}
      viewBox="216 300 592 424"
    >
      <path d="M289.455 308H734.545L800 548H224L289.455 308Z" fill="#101820" />
      <path
        d="M733.782 309L798.69 547H225.31L290.218 309H733.782Z"
        fill="none"
        stroke="#fff"
        strokeOpacity=".22"
        strokeWidth="10"
      />
      <rect x="224" y="500" width="576" height="216" rx="48" fill="#101820" />
      <rect
        x="225"
        y="501"
        width="574"
        height="214"
        rx="47"
        fill="none"
        stroke="#fff"
        strokeOpacity=".22"
        strokeWidth="10"
      />
      <rect x="584" y="620" width="120" height="24" fill="#4A90FF" />
      <path
        d="M237.125 500H786.969L793.625 524H230.469L237.125 500Z"
        fill="#C9D0DA"
      />
    </svg>
  );
}
