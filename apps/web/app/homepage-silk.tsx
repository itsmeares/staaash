type SilkBackgroundProps = {
  className?: string;
};

export function SilkBackground({ className }: SilkBackgroundProps) {
  return (
    <div
      aria-hidden="true"
      className={["landing-silk", className].filter(Boolean).join(" ")}
    >
      <div className="landing-silk-band landing-silk-band-a" />
      <div className="landing-silk-band landing-silk-band-b" />
      <div className="landing-silk-noise" />
    </div>
  );
}
