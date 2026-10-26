const HERE = "http://drive.invalid";

/** A path on this site, or undefined for anything that could leave it. */
export const getSafeLocalPath = (value: string | undefined) => {
  if (!value?.startsWith("/")) return undefined;
  // Parse it the way the browser will: it drops tabs and line breaks and
  // reads "\" as "/", so "/\t/host" and "/\host" lead to another site.
  const url = new URL(value, HERE);
  return url.origin === HERE
    ? `${url.pathname}${url.search}${url.hash}`
    : undefined;
};
