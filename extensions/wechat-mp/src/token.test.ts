import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearAccessTokenCache,
  clearAllAccessTokenCache,
  getAccessToken,
  getTokenCacheStatus,
  isInvalidTokenError,
  refreshToken,
  shouldRefreshToken,
} from "./token.js";
import type { ResolvedWechatMpAccount } from "./types.js";

function createAccount(overrides?: Partial<ResolvedWechatMpAccount>): ResolvedWechatMpAccount {
  return {
    accountId: "default",
    name: "WeChat MP (default)",
    enabled: true,
    configured: true,
    canSendActive: true,
    config: {
      appId: "wx-test-appid",
      appSecret: "secret",
      token: "token",
      encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      webhookPath: "/wechat-mp",
      messageMode: "safe",
      replyMode: "passive",
    },
    ...overrides,
  };
}

afterEach(() => {
  clearAllAccessTokenCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("wechat-mp token", () => {
  it("fetches and caches access token", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        access_token: "token-1",
        expires_in: 7200,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const account = createAccount();
    const first = await getAccessToken(account);
    const second = await getAccessToken(account);

    expect(first).toBe("token-1");
    expect(second).toBe("token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getTokenCacheStatus(account).cached).toBe(true);
  });

  it("refreshes after cache clear", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => ({ access_token: "token-1", expires_in: 7200 }) })
      .mockResolvedValueOnce({ json: async () => ({ access_token: "token-2", expires_in: 7200 }) });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const account = createAccount();
    expect(await getAccessToken(account)).toBe("token-1");
    clearAccessTokenCache(account);
    expect(await refreshToken(account)).toBe("token-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("identifies invalid token errcodes", () => {
    expect(isInvalidTokenError(40001)).toBe(true);
    expect(isInvalidTokenError(42001)).toBe(true);
    expect(isInvalidTokenError(12345)).toBe(false);
  });

  it("reports refresh need from cache status", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({
        access_token: "token-1",
        expires_in: 60,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const account = createAccount();
    await getAccessToken(account);
    expect(typeof shouldRefreshToken(account)).toBe("boolean");
  });
});
