"use client";

import { useRef } from "react";

import { useShake } from "@/components/public/use-shake";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SharePasswordForm({
  action,
  redirectPath,
  error,
}: {
  action: string;
  redirectPath: string;
  error: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  useShake(input, error);
  return (
    <form
      action={action}
      className="grid w-[min(100%,340px)] gap-2"
      method="post"
    >
      <input name="redirectTo" type="hidden" value={redirectPath} />
      <div className="flex gap-2">
        <Input
          ref={input}
          aria-describedby={error ? "share-password-error" : undefined}
          aria-invalid={error ? true : undefined}
          aria-label="Password"
          autoComplete="current-password"
          autoFocus
          className={cn(
            "h-11 flex-1 border-white/18 bg-black/30 text-base backdrop-blur-sm placeholder:text-white/40",
            error && "border-destructive/70",
          )}
          id="share-password"
          name="password"
          placeholder="Password"
          required
          type="password"
        />
        <Button className="h-11 px-5" type="submit">
          Open
        </Button>
      </div>
      {error ? (
        <span
          className="text-start text-label text-destructive-foreground"
          id="share-password-error"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </form>
  );
}
