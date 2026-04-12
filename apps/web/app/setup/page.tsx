import Link from "next/link";
import { redirect } from "next/navigation";

import { FlashMessage, getSingleSearchParam } from "@/app/auth-ui";
import { EntryMetaList } from "@/components/public/entry-meta-list";
import { EntryShell } from "@/components/public/entry-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getCurrentSession } from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export const dynamic = "force-dynamic";

type SetupPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const [resolvedSearchParams, setupState, session] = await Promise.all([
    searchParams,
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (setupState.isBootstrapped) {
    redirect(session ? "/library" : "/sign-in");
  }

  const error = getSingleSearchParam(resolvedSearchParams, "error");

  return (
    <EntryShell topNote="One-time bootstrap">
      <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.96fr)] lg:gap-14">
        <section className="max-w-xl">
          <p className="entry-kicker">Initialize once</p>
          <div className="mt-5 flex flex-col gap-4">
            <h1 className="font-heading text-balance text-[clamp(3rem,7vw,5.25rem)] leading-[0.95] tracking-[-0.055em] text-foreground">
              Create the first owner and open the instance.
            </h1>
            <p className="max-w-lg text-base leading-7 text-muted-foreground md:text-lg">
              Bootstrap runs exactly once. It creates the instance record, the
              first owner account, and the initial signed-in session.
            </p>
          </div>

          <EntryMetaList
            className="mt-8 max-w-lg"
            items={[
              {
                label: "Open signup",
                value: "Disabled after bootstrap.",
              },
              {
                label: "First account",
                value: "Created as the owner.",
              },
              {
                label: "Auth model",
                value:
                  "Email or username with a password managed by this instance.",
              },
            ]}
          />
        </section>

        <Card className="border border-border/70 bg-card/88 shadow-[0_26px_80px_rgba(3,11,16,0.22)]">
          <CardHeader>
            <CardTitle>Bootstrap owner</CardTitle>
            <CardDescription>
              Fill this out once. The setup route closes immediately after the
              first owner account is created.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-5">
              {error ? <FlashMessage>{error}</FlashMessage> : null}

              <form
                action="/api/auth/setup"
                className="flex flex-col gap-5"
                method="post"
              >
                <FieldGroup className="gap-5">
                  <Field>
                    <FieldLabel htmlFor="instanceName">
                      Instance name
                    </FieldLabel>
                    <Input
                      id="instanceName"
                      name="instanceName"
                      placeholder="Staaash Home Drive"
                      required
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="username">Owner username</FieldLabel>
                    <Input
                      autoComplete="username"
                      id="username"
                      maxLength={32}
                      minLength={3}
                      name="username"
                      pattern="^(?!-)(?!.*--)[a-z0-9-]{3,32}(?<!-)$"
                      placeholder="johnsmith"
                      required
                    />
                    <FieldDescription>
                      Lowercase letters, numbers, and single hyphens only.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="displayName">
                      Owner display name
                    </FieldLabel>
                    <Input
                      id="displayName"
                      name="displayName"
                      placeholder="Instance owner"
                    />
                    <FieldDescription>
                      Presentation only. This does not affect the on-disk path.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="email">Owner email</FieldLabel>
                    <Input
                      autoComplete="email"
                      id="email"
                      name="email"
                      required
                      type="email"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      autoComplete="new-password"
                      id="password"
                      minLength={12}
                      name="password"
                      required
                      type="password"
                    />
                    <FieldDescription>
                      Use at least 12 characters. Sessions stay server-side.
                    </FieldDescription>
                  </Field>
                </FieldGroup>

                <Button className="w-full" size="lg" type="submit">
                  Create owner and continue
                </Button>
              </form>
            </div>
          </CardContent>
          <CardFooter className="border-t border-border/65 pt-6">
            <Link
              className={buttonVariants({
                variant: "link",
              })}
              href="/"
            >
              Back to entry
            </Link>
          </CardFooter>
        </Card>
      </div>
    </EntryShell>
  );
}
