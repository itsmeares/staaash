import { afterEach, expect, it, vi } from "vite-plus/test";

import { signInWithBrowser } from "./auth";

const openExternal = vi.hoisted(() => vi.fn());
vi.mock("electron", () => ({ shell: { openExternal } }));

const localFetch = fetch;
afterEach(() => vi.unstubAllGlobals());

it.each([null, "data:image/jpeg;base64,photo"])(
  "keeps the account photo returned by device sign-in: %s",
  async (avatarUrl) => {
    openExternal.mockImplementation(async (address: string) => {
      const callback = new URL(
        new URL(address).searchParams.get("redirect_uri")!,
      );
      callback.searchParams.set("code", "test-code");
      await localFetch(callback);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          token: "test-device-token",
          session: { user: { email: "owner@example.test", avatarUrl } },
        }),
      ),
    );
    await expect(
      signInWithBrowser("https://drive.example.test", "Test computer"),
    ).resolves.toEqual({
      token: "test-device-token",
      email: "owner@example.test",
      avatarUrl,
    });
  },
);
