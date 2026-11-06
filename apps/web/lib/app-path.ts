/**
 * An app path as the browser should load it. Normal builds live at "/"; the
 * public demo is built for a base path such as "/staaash/".
 */
export const appPath = (path: string) =>
  `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
