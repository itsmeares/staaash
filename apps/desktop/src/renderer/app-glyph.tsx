/** The desktop app's drive mark. The tray and app icons use the same shape. */
export function AppGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="0 0 36 28">
      <path d="M7 2h22l6 14H1z" fill="#3e424a" />
      <rect
        fill="#12161e"
        height="14"
        rx="3.5"
        stroke="#2c3039"
        width="34"
        x="1"
        y="13"
      />
      <rect fill="#4a90ff" height="1.8" rx=".9" width="7" x="23" y="19" />
    </svg>
  );
}
