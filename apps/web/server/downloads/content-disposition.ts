/**
 * RFC 8187 `filename*`. encodeURIComponent leaves ' ( ) * as they are, but
 * the header may not hold them, and browsers then drop the whole name.
 */
export const contentDisposition = (
  type: "attachment" | "inline",
  fileName: string,
) =>
  `${type}; filename*=UTF-8''${encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;
