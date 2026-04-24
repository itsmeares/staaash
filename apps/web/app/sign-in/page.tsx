import Link from "next/link";
import { redirect } from "next/navigation";

import {
  FlashMessage,
  getSafeLocalPath,
  getSingleSearchParam,
} from "@/app/auth-ui";
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

type SignInPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [resolvedSearchParams, setupState, session] = await Promise.all([
    searchParams,
    authService.getSetupState(),
    getCurrentSession(),
  ]);

  if (!setupState.isBootstrapped) {
    redirect("/setup");
  }

  const next = getSafeLocalPath(
    getSingleSearchParam(resolvedSearchParams, "next"),
    "/files",
  );
  const error = getSingleSearchParam(resolvedSearchParams, "error");
  const success = getSingleSearchParam(resolvedSearchParams, "success");

  if (session) {
    redirect(next);
  }

  return (
    <EntryShell>
      <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.92fr)] lg:gap-14">
        <section className="max-w-xl">
          <p className="entry-kicker">Access the instance</p>
          <div className="mt-5 flex flex-col gap-4">
            <h1 className="font-heading text-balance text-[clamp(3rem,7vw,5.25rem)] leading-[0.95] tracking-[-0.055em] text-foreground">
              Sign in to continue.
            </h1>
            <p className="max-w-lg text-base leading-7 text-muted-foreground md:text-lg">
              This Staaash instance is already running. Access remains
              invite-only after bootstrap.
            </p>
          </div>

          <EntryMetaList
            className="mt-8 max-w-lg"
            items={[
              {
                label: "Recovery",
                value: "Password reset links are issued by the owner.",
              },
              {
                label: "Next step",
                value:
                  "Sign-in returns you to files unless a safe local path is provided.",
              },
            ]}
          />
        </section>

        <Card className="border border-border/70 bg-card/88 shadow-[0_26px_80px_rgba(3,11,16,0.22)]">
          <CardHeader>
            <CardTitle>Local account sign-in</CardTitle>
            <CardDescription>
              Use the email, username, and password already configured for this
              instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-5">
              {error ? <FlashMessage>{error}</FlashMessage> : null}
              {success ? (
                <FlashMessage tone="success">{success}</FlashMessage>
              ) : null}

              <form
                action="/api/auth/sign-in"
                className="flex flex-col gap-5"
                method="post"
              >
                <input type="hidden" name="next" value={next} />

                <FieldGroup className="gap-5">
                  <Field>
                    <FieldLabel htmlFor="identifier">
                      Email or username
                    </FieldLabel>
                    <Input
                      autoComplete="username"
                      id="identifier"
                      name="identifier"
                      required
                    />
                    <FieldDescription>
                      Use the account identifier created by the owner.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      autoComplete="current-password"
                      id="password"
                      name="password"
                      required
                      type="password"
                    />
                  </Field>
                </FieldGroup>

                <Button className="w-full" size="lg" type="submit">
                  Sign in
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
