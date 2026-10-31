import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applyTheme, watchSystemTheme } from "@/lib/theme";

import { App } from "./shell";
import { TopRow } from "./title-bar";

// The desktop app always follows the system's light or dark setting.
applyTheme("system");
watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The drive window shows only the top row above the web app. */}
    {location.search === "?top-row" ? <TopRow /> : <App />}
  </StrictMode>,
);
