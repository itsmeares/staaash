/** The public demo build: the real frontend, with a sample API in the browser. */
export const isDemo = import.meta.env.MODE === "demo";

export const demoAccount = {
  email: "jesse@devries.home",
  password: "staaash-demo",
};

/** Opened from the demo bar to show what a share link visitor sees. */
export const demoShareToken = "home-renovation";

declare global {
  interface ImportMetaEnv {
    /** Set by the demo workflow on the stable demo when a newer RC exists. */
    readonly VITE_DEMO_RC_VERSION?: string;
    /** Set by the demo workflow on the RC demo: the stable version. */
    readonly VITE_DEMO_STABLE_VERSION?: string;
  }
}

/** On the stable demo, the newer release candidate it offers at /rc/. */
export const demoCandidate = import.meta.env.VITE_DEMO_RC_VERSION || null;

/** On the release candidate demo, the stable release it goes back to. */
export const demoStable = import.meta.env.VITE_DEMO_STABLE_VERSION || null;
