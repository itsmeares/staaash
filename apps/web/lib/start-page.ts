/** Where Staaash opens after sign-in, from Settings → Appearance. */
export const startPath = (startPage: string | null | undefined) =>
  startPage === "home" ? "/home" : "/files";
