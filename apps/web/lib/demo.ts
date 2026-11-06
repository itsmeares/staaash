/** The public demo build: the real frontend, with a sample API in the browser. */
export const isDemo = import.meta.env.MODE === "demo";

export const demoAccount = {
  email: "alex@example.com",
  password: "staaash-demo",
};

/** Opened from the demo bar to show what a share link visitor sees. */
export const demoShareToken = "beach-weekend";
