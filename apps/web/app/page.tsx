import Link from "next/link";
import { redirect } from "next/navigation";

import { EntryShell } from "@/components/public/entry-shell";
import { SilkBackground } from "@/components/public/silk-background";
import { buttonVariants } from "@/components/ui/button";
import { getHomePageContent } from "@/app/homepage-content";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [setupState, session] = await Promise.all([
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (session) {
    redirect("/library");
  }

  const content = getHomePageContent({
    isBootstrapped: setupState.isBootstrapped,
    role: null,
  });

  return (
    <EntryShell
      background={
        <SilkBackground
          color="#c8ab72"
          noiseIntensity={1.1}
          opacity={0.56}
          rotation={0.1}
          scale={1.08}
          speed={4.2}
        />
      }
    >
      <section className="entry-gateway">
        <div className="entry-gateway__copy">
          <h1 className="entry-gateway__title font-heading text-[clamp(3.5rem,7.6vw,6.6rem)] leading-[0.94] tracking-[-0.06em] text-foreground">
            {content.title}
          </h1>
          <p className="entry-gateway__description text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
            {content.description}
          </p>

          <div className="entry-gateway__actions">
            <Link
              className={buttonVariants({
                size: "lg",
                className:
                  "entry-gateway__primary-action h-12 px-6 text-[0.95rem] font-semibold",
              })}
              href={content.primaryAction.href}
            >
              {content.primaryAction.label}
            </Link>

            {content.secondaryAction ? (
              <Link
                className={buttonVariants({
                  size: "lg",
                  variant: "link",
                  className: "entry-gateway__secondary-action",
                })}
                href={content.secondaryAction.href}
              >
                {content.secondaryAction.label}
              </Link>
            ) : null}
          </div>

          {content.supportNote ? (
            <p className="entry-gateway__support text-sm leading-6 text-[color:var(--entry-muted-soft)] sm:text-[0.95rem]">
              {content.supportNote}
            </p>
          ) : null}
        </div>
      </section>
    </EntryShell>
  );
}
