"use client";

import { Clock, KeyRound, Palette, RefreshCw, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  SettingsCard,
  SettingsLayout,
  SettingsRow,
} from "@/components/settings-layout";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast, toastManager } from "@/components/ui/toast";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const THEMES: { value: Theme; label: string; swatch: string }[] = [
  {
    value: "system",
    label: "System",
    swatch: "linear-gradient(90deg,#f6f4f1 50%,#1a1816 50%)",
  },
  { value: "light", label: "Light", swatch: "#f6f4f1" },
  { value: "dark", label: "Dark", swatch: "#1a1816" },
];

type Preferences = {
  theme?: Theme;
  timeZone?: string;
  showUpdateNotifications?: boolean;
};

/** Each change saves on its own and says so, so there's no Save button. */
const usePreferenceSaver = () => {
  const router = useRouter();
  return async (change: Preferences, refresh = false) => {
    try {
      const response = await fetch("/api/user/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "Could not save.");
      }
      toastManager.add({ title: "Saved", type: "success", timeout: 1500 });
      // Dates rendered on the server pick up a new time zone.
      if (refresh) router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save.");
    }
  };
};

export function PersonalSettings({
  name,
  email,
  role,
  isOwner,
  initialTheme,
  initialTimeZone,
  initialShowUpdates,
  session,
}: {
  name: string | null;
  email: string;
  role: string;
  isOwner: boolean;
  initialTheme: Theme;
  initialTimeZone: string;
  initialShowUpdates: boolean;
  session: { signedIn: ReactNode; expires: ReactNode };
}) {
  const save = usePreferenceSaver();
  const [theme, setTheme] = useState(initialTheme);
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [showUpdates, setShowUpdates] = useState(initialShowUpdates);

  const categories = [
    {
      id: "profile",
      label: "Profile",
      icon: UserRound,
      content: (
        <SettingsCard>
          <SettingsRow hint={email} label={name ?? email}>
            <Badge variant="neutral">{role}</Badge>
          </SettingsRow>
        </SettingsCard>
      ),
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: Palette,
      content: (
        <SettingsCard>
          <div
            aria-label="Theme"
            className="grid grid-cols-3 gap-2 p-3.5"
            role="radiogroup"
          >
            {THEMES.map((option) => (
              <button
                aria-checked={theme === option.value}
                className={cn(
                  "grid cursor-pointer gap-1.5 rounded-xl border border-border p-1.5 text-meta outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
                  theme === option.value &&
                    "border-primary ring-2 ring-primary/30",
                )}
                key={option.value}
                role="radio"
                type="button"
                onClick={() => {
                  setTheme(option.value);
                  applyThemeWithTransition(option.value);
                  void save({ theme: option.value });
                }}
              >
                <span
                  className="block h-12 rounded-lg border border-border"
                  style={{ background: option.swatch }}
                />
                {option.label}
              </button>
            ))}
          </div>
        </SettingsCard>
      ),
    },
    {
      id: "time",
      label: "Date and time",
      icon: Clock,
      content: (
        <SettingsCard>
          <SettingsRow label="Time zone">
            <TimeZonePicker
              allowAuto
              value={timeZone}
              onChange={(next) => {
                setTimeZone(next);
                void save({ timeZone: next }, true);
              }}
            />
          </SettingsRow>
        </SettingsCard>
      ),
    },
    {
      id: "signed-in",
      label: "Signed in",
      icon: KeyRound,
      content: (
        <SettingsCard>
          <SettingsRow hint={session.signedIn} label="This browser" />
          <SettingsRow hint={session.expires} label="Signed in until" />
        </SettingsCard>
      ),
    },
    ...(isOwner
      ? [
          {
            id: "updates",
            label: "Updates",
            icon: RefreshCw,
            content: (
              <SettingsCard>
                <SettingsRow
                  hint="A note in the sidebar and a short announcement"
                  label="Tell me about new versions"
                >
                  <Switch
                    aria-label="Tell me about new versions"
                    checked={showUpdates}
                    onCheckedChange={(next) => {
                      setShowUpdates(next);
                      void save({ showUpdateNotifications: next }, true);
                    }}
                  />
                </SettingsRow>
              </SettingsCard>
            ),
          },
        ]
      : []),
  ];

  return <SettingsLayout categories={categories} />;
}
