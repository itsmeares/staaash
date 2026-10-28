import { useEffect, useState } from "react";

import type { AppState, DesktopApi } from "../shared/types";

declare global {
  interface Window {
    staaash: DesktopApi;
  }
}

export const desktop = window.staaash;

/** The app state the main process pushes; null until the first copy arrives. */
export const useAppState = () => {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    void desktop.getState().then(setState);
    return desktop.onState(setState);
  }, []);
  return state;
};
