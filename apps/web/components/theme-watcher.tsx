"use client";

import { useEffect } from "react";

import { watchSystemTheme } from "@/lib/theme";

export function ThemeWatcher() {
  useEffect(() => watchSystemTheme(), []);
  return null;
}
