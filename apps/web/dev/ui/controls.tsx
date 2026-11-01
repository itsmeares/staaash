import "../../src/globals.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@staaash/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@staaash/ui/components/card";
import { Label } from "@staaash/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@staaash/ui/components/select";
import { DriveGlyph } from "../../components/drive-glyph";
import { ThemeWatcher } from "../../components/theme-watcher";
import { applyTheme } from "../../lib/theme";
import type { Scenario } from "./state";

type Controls = {
  scenario: Scenario;
  scenarios: Record<Scenario, string>;
  password: string;
  users: Array<{ email: string; role: string }>;
  userId: string | null;
  archiveFolderId: string | null;
};
const pages = [
  ["Home", "/home"],
  ["Files", "/files"],
  ["Favorites", "/favorites"],
  ["Recent", "/recent"],
  ["Search", "/search?q=photo"],
  ["Shared", "/shared"],
  ["Trash", "/trash"],
  ["Settings", "/settings"],
  ["Overview", "/admin"],
  ["Storage", "/admin/storage"],
  ["Users", "/admin/users"],
  ["Jobs", "/admin/jobs"],
  ["Instance settings", "/admin/settings"],
  ["Sign-in and setup", "/"],
  ["Missing page", "/missing-sample-page"],
  ["Shared photo", "/s/owner-photo"],
  ["Shared folder", "/s/owner-folder"],
  ["Shared nested folder", "/s/owner-folder/f/owner-holiday"],
  ["Password-protected share", "/s/owner-locked"],
  ["Revoked share", "/s/owner-revoked"],
  ["Expired share", "/s/owner-expired"],
];
function ControlsPage() {
  const [data, setData] = useState<Controls | null>(null);
  const [scenario, setScenario] = useState<Scenario>("owner");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/__ui/state", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Preview controls could not load.");
        const value = (await response.json()) as Controls;
        setData(value);
        setScenario(value.scenario);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Preview controls could not load.",
          );
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      <ThemeWatcher />
      <main className="mx-auto grid max-w-4xl gap-8 px-5 py-10 sm:py-16">
        <header className="flex items-start gap-4">
          <DriveGlyph />
          <div className="grid gap-2">
            <h1 className="font-heading text-3xl tracking-tight">
              Frontend preview
            </h1>
            <p className="max-w-prose text-body text-muted-foreground">
              Work with sample files and accounts. Changes stay in this browser
              session. Reset or restart clears them.
            </p>
          </div>
        </header>
        {error && (
          <p role="alert" className="text-destructive-foreground">
            {error}
          </p>
        )}
        {data && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Choose a starting state</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  action="/__ui/scenario"
                  method="post"
                  className="flex flex-wrap items-end gap-3"
                >
                  <div className="grid min-w-60 flex-1 gap-2">
                    <Label htmlFor="scenario">Sample state</Label>
                    <Select
                      name="scenario"
                      value={scenario}
                      onValueChange={(value) =>
                        value && setScenario(value as Scenario)
                      }
                    >
                      <SelectTrigger id="scenario">
                        <SelectValue>{data.scenarios[scenario]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(data.scenarios).map(
                          ([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit">Reset samples</Button>
                  <Button variant="outline" render={<a href="/files" />}>
                    Open drive
                  </Button>
                </form>
                <p className="mt-4 text-label text-muted-foreground">
                  Current state: {data.scenarios[data.scenario]}. Uploaded
                  samples share a 16 MiB limit.
                </p>
              </CardContent>
            </Card>
            <section className="grid gap-4">
              <h2 className="font-heading text-xl">Open a page</h2>
              <nav aria-label="Preview pages" className="flex flex-wrap gap-2">
                {data.archiveFolderId && (
                  <Button
                    variant="outline"
                    render={<a href={`/files/f/${data.archiveFolderId}`} />}
                  >
                    Photo archive
                  </Button>
                )}
                {pages.map(([label, path]) => (
                  <Button
                    key={path}
                    variant="outline"
                    render={<a href={path} />}
                  >
                    {label}
                  </Button>
                ))}
                {data.scenario === "busy" && (
                  <Button
                    variant="outline"
                    render={
                      <a
                        href={`/files/storage-unavailable?folderId=${data.userId}-root`}
                      />
                    }
                  >
                    Storage recovery
                  </Button>
                )}
              </nav>
            </section>
            <section className="grid gap-3">
              <h2 className="font-heading text-xl">Sample accounts</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-body">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 font-medium">Role</th>
                      <th className="py-2 font-medium">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <tr key={user.email} className="border-b border-border">
                        <td className="py-2 capitalize">{user.role}</td>
                        <td className="py-2">{user.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-body text-muted-foreground">
                Password for the sample accounts and locked share:{" "}
                <code className="text-foreground">{data.password}</code>
              </p>
            </section>
          </>
        )}
        <p className="max-w-prose text-label text-muted-foreground">
          Use this preview to check screens and interactions. Use a real demo
          for file safety, permissions, database queries, and background jobs.
        </p>
      </main>
    </>
  );
}
const savedTheme = document.cookie.match(
  /(?:^|; )staaash_theme=(dark|light)/,
)?.[1];
applyTheme(
  savedTheme === "dark" ? "dark" : savedTheme === "light" ? "light" : "system",
);
createRoot(document.getElementById("root")!).render(<ControlsPage />);
