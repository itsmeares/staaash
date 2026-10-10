"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SettingsList, SettingsRow } from "@/components/settings-panel";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { applyThemeWithTransition, type Theme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

type Preferences = {
  theme?: Theme;
  timeZone?: string;
  showUpdateNotifications?: boolean;
};

/** Each change saves on its own, so there is no Save button to forget. */
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
      // Dates on the server pick up a new time zone.
      if (refresh) router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not save.");
    }
  };
};

export function AppearanceSettings({ initialTheme }: { initialTheme: Theme }) {
  const save = usePreferenceSaver();
  const [theme, setTheme] = useState(initialTheme);
  return (
    <SettingsList plain>
      <SettingsRow
        label="Theme"
        hint="How Staaash looks in this browser."
        plain
      >
        <Tabs
          value={theme}
          onValueChange={(next) => {
            const value = next as Theme;
            setTheme(value);
            applyThemeWithTransition(value);
            void save({ theme: value });
          }}
        >
          <TabsList aria-label="Theme">
            {THEME_OPTIONS.map((option) => (
              <TabsTab key={option.value} value={option.value}>
                {option.label}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </SettingsRow>
    </SettingsList>
  );
}

export function RegionSettings({
  initialTimeZone,
}: {
  initialTimeZone: string;
}) {
  const save = usePreferenceSaver();
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  return (
    <SettingsList plain>
      <SettingsRow
        label="Time zone"
        hint="Used for every date shown to you. Automatic follows this browser."
        plain
      >
        <TimeZonePicker
          allowAuto
          value={timeZone}
          onChange={(next) => {
            setTimeZone(next);
            void save({ timeZone: next }, true);
          }}
        />
      </SettingsRow>
    </SettingsList>
  );
}

export function UpdateSettings({ initialShow }: { initialShow: boolean }) {
  const save = usePreferenceSaver();
  const [show, setShow] = useState(initialShow);
  return (
    <SettingsList plain>
      <SettingsRow
        label="Tell me about new versions"
        hint="A note in the sidebar and a short announcement when Staaash has an update."
        plain
      >
        <Switch
          aria-label="Tell me about new versions"
          checked={show}
          onCheckedChange={(next) => {
            setShow(next);
            void save({ showUpdateNotifications: next }, true);
          }}
        />
      </SettingsRow>
    </SettingsList>
  );
}
