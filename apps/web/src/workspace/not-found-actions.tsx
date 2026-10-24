import { AppLink } from "@/components/app-link";

import { Button } from "@staaash/ui/components/button";

export function NotFoundActions() {
  return (
    <div className="flex gap-2">
      <Button variant="ghost" onClick={() => history.back()}>
        Back
      </Button>
      <Button render={<AppLink href="/files" />}>Go to Files</Button>
    </div>
  );
}
