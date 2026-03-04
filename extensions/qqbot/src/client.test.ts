import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  httpPost: vi.fn(),
  httpGet: vi.fn(),
}));

vi.mock("@openclaw-china/shared", async () => {
  const actual = await vi.importActual<typeof import("@openclaw-china/shared")>(
    "@openclaw-china/shared"
  );
  return {
    ...actual,
    httpPost: mocks.httpPost,
    httpGet: mocks.httpGet,
  };
});

import { clearTokenCache, getAccessToken } from "./client.js";

describe("getAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokenCache();
  });

  it("coerces numeric appId into string request payload", async () => {
    mocks.httpPost.mockResolvedValue({
      access_token: "token-1",
      expires_in: 7200,
    });

    const token = await getAccessToken(102824485, " secret ");

    expect(token).toBe("token-1");
    expect(mocks.httpPost).toHaveBeenCalledWith(
      "https://bots.qq.com/app/getAppAccessToken",
      { appId: "102824485", clientSecret: "secret" },
      { timeout: 15000 }
    );
  });

  it("rejects empty appId values after trimming", async () => {
    await expect(getAccessToken("  ", "secret")).rejects.toThrow("appId");
    expect(mocks.httpPost).not.toHaveBeenCalled();
  });
});
