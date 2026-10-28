import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyTheme, watchSystemTheme } from "@/lib/theme";

import { Panel } from "./panel";
import { SettingsWindow } from "./settings";

// The desktop app always follows the system's light or dark setting.
applyTheme("system");
watchSystemTheme();

const View = location.hash === "#panel" ? Panel : SettingsWindow;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
