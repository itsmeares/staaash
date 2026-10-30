import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyTheme, watchSystemTheme } from "@/lib/theme";

import { App } from "./shell";

// The desktop app always follows the system's light or dark setting.
applyTheme("system");
watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
