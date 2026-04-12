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
      topNote="Your drive, your privacy."
    >
      <section className="relative w-full">
        <div className="max-w-4xl">
          <div className="flex flex-col gap-5">
            <h1 className="font-heading text-balance text-[clamp(3.6rem,10vw,7.8rem)] leading-[0.9] tracking-[-0.065em] text-foreground">
              {content.title}
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">
              {content.description}
            </p>
          </div>

          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              className={buttonVariants({
                size: "lg",
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
                })}
                href={content.secondaryAction.href}
              >
                {content.secondaryAction.label}
              </Link>
            ) : null}
          </div>

          {content.supportNote ? (
            <p className="mt-8 max-w-xl text-sm leading-6 text-[color:var(--entry-muted-soft)] sm:text-[0.95rem]">
              {content.supportNote}
            </p>
          ) : null}
        </div>
      </section>
    </EntryShell>
  );
}
