"use client";

import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ShareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[share] client error:", error);
  }, [error]);

  return (
    <main className="mx-auto grid w-[min(600px,calc(100vw-48px))] gap-4 py-12 max-sm:w-[min(100vw-28px,600px)] max-sm:py-7">
      <Card className="items-start gap-4 p-6 max-sm:p-4.5">
        <Badge>Share error</Badge>
        <h1 className="m-0 text-lg font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="m-0 text-muted-foreground">
          This shared link could not be displayed. Try refreshing the page.
        </p>
        <Button onClick={reset}>Try again</Button>
      </Card>
    </main>
  );
}
