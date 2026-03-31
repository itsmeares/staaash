export function PlaceholderPage({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="workspace-page">
      <section className="panel stack">
        <div className="pill">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </section>

      <section className="panel stack workspace-empty-state">
        <h2>Planned, not faked</h2>
        <p className="muted">
          This surface is intentionally present in the shell now so navigation
          stays stable, but the real data flow lands in a later phase.
        </p>
      </section>
    </div>
  );
}
