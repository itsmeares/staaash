import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyTheme, watchSystemTheme } from "@/lib/theme";

import type { AppState } from "../shared/types";
import { App } from "./shell";
import { desktop } from "./state";
import { TopRow } from "./title-bar";

// The page applies the theme setting itself: on Linux the main process's
// theme choice does not reach prefers-color-scheme.
let driveTheme = false;
const follow = (state: AppState) => {
  if (!driveTheme) applyTheme(state.settings.theme);
};
applyTheme("system");
watchSystemTheme();
void desktop.getState().then(follow);
desktop.onState(follow);
// The drive window's top row matches the web drive below it instead.
if (location.search === "?top-row")
  desktop.onDriveTheme((dark) => {
    driveTheme = true;
    applyTheme(dark ? "dark" : "light");
  });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The drive window shows only the top row above the web app. */}
    {location.search === "?top-row" ? <TopRow /> : <App />}
  </StrictMode>,
);
