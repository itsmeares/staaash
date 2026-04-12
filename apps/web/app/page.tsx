import Link from "next/link";

import { getHomePageContent } from "@/app/homepage-content";
import { SilkBackground } from "@/app/homepage-silk";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [setupState, session] = await Promise.all([
    authService.getSetupState(),
    getCurrentSession(),
  ]);
  const content = getHomePageContent({
    isBootstrapped: setupState.isBootstrapped,
    role: session?.user.role ?? null,
  });
  const proofPoints = [
    {
      title: "Storage stays local",
      body: "Files remain under your own root with app-managed keys and explicit ownership boundaries.",
    },
    {
      title: "Sharing is deliberate",
      body: "Invite-only access and protected shares keep collaboration intentional instead of ambient.",
    },
    {
      title: "Mistakes are recoverable",
      body: "Trash, restore, and typed server contracts keep routine file operations safe to execute.",
    },
  ];
  const productNotes = [
    "A quiet library surface for upload, retrieval, sharing, and search.",
    "A dedicated admin plane for health, users, invites, jobs, and storage checks.",
    "A worker runtime behind the scenes so the interface stays calm while the system does real work.",
  ];

  return (
    <main className="landing-page">
      <section className="landing-hero">
        <SilkBackground />

        <div className="landing-hero-copy">
          <div className="landing-kicker">{content.heroLabel}</div>
          <p className="landing-mark">Staaash</p>
          <h1 className="landing-title">
            A self-hosted drive that feels owned, not rented.
          </h1>
          <p className="landing-intro">
            Keep the surface, storage, and boundaries in one place. Staaash is
            the calm front door to a private cloud drive you actually control.
          </p>
          <div className="landing-actions">
            <Link
              className="landing-primary-action"
              href={content.primaryAction.href}
            >
              {content.primaryAction.label}
            </Link>
            <nav
              className="landing-secondary-links"
              aria-label="Secondary navigation"
            >
              {content.secondaryLinks.map((link) => (
                <Link
                  key={link.href}
                  className="landing-secondary-link"
                  href={link.href}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <aside className="landing-hero-aside">
          <div className="landing-aside-label">Why it feels different</div>
          <p>
            No subscription theater. No public signup funnel. Just a direct path
            into your own storage surface.
          </p>
          <div className="landing-aside-rule" />
          <p>
            Typed routes, deliberate sharing, and a dedicated worker runtime
            keep the experience steady without turning the homepage into a
            dashboard.
          </p>
        </aside>
      </section>

      <section
        className="landing-proof-strip"
        aria-label="Staaash trust points"
      >
        {proofPoints.map((point) => (
          <article key={point.title} className="landing-proof-item">
            <h2>{point.title}</h2>
            <p>{point.body}</p>
          </article>
        ))}
      </section>

      <section className="landing-story">
        <div className="landing-story-copy">
          <div className="landing-section-label">Product surface</div>
          <h2>Built for the part after the files arrive.</h2>
          <p>
            Staaash is not a public file dump and it is not an enterprise portal
            in disguise. It is a private library surface for people who want
            their storage to remain theirs, with enough structure to feel safe
            every day.
          </p>
        </div>

        <div className="landing-story-notes">
          {productNotes.map((note) => (
            <article key={note} className="landing-note">
              <p>{note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-operator">
        <div className="landing-operator-copy">
          <div className="landing-section-label">Operator trust</div>
          <h2>Technical where it needs to be, quiet everywhere else.</h2>
          <p>
            Owner tooling lives behind a dedicated control plane, while storage
            data stays rooted under <code>{env.FILES_ROOT}</code>. Health routes
            remain available when you need to check the system, not as the main
            thing the homepage asks you to admire.
          </p>
        </div>
        <div className="landing-operator-links">
          {session?.user.role === "owner" ? (
            <Link className="landing-operator-link" href="/admin">
              Open admin
            </Link>
          ) : null}
          <Link className="landing-operator-link" href="/api/health/live">
            Live health
          </Link>
          <Link className="landing-operator-link" href="/api/health/ready">
            Readiness
          </Link>
          <Link className="landing-operator-link" href="/api/admin/health">
            Admin health JSON
          </Link>
        </div>
      </section>
    </main>
  );
}
