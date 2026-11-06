const sharePage = /^\/s\/[^/]+(?:\/(?:f|files)\/[^/]+)?\/?$/;

/** Requests the sample API answers; everything else is the app itself. */
export function handlesRequest(path: string, method: string) {
  if (["/__ui/", "/api/"].some((prefix) => path.startsWith(prefix)))
    return true;
  if (path === "/auth/device-callback") return true;
  return path.startsWith("/s/") && !(method === "GET" && sharePage.test(path));
}
