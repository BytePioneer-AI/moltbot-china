import { afterEach, describe, expect, it, vi } from "vitest";

import { clearAllAccessTokenCache, getAccessToken, sendWecomAppMessage } from "./api.js";
import type { ResolvedWecomAppAccount } from "./types.js";

function createAccount(apiBaseUrl?: string): ResolvedWecomAppAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    token: "token",
    encodingAESKey: "encoding-aes-key",
    receiveId: "corp-id",
    corpId: "corp-id",
    corpSecret: "corp-secret",
    agentId: 1000002,
    canSendActive: true,
    config: {
      corpId: "corp-id",
      corpSecret: "corp-secret",
      agentId: 1000002,
      apiBaseUrl,
    },
  };
}

function mockJsonResponse(payload: unknown): Response {
  return {
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

afterEach(() => {
  clearAllAccessTokenCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("wecom-app api base url", () => {
  it("uses configured apiBaseUrl for gettoken", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ errcode: 0, access_token: "token-a" }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const token = await getAccessToken(createAccount("https://proxy.wecom.local///"));

    expect(token).toBe("token-a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://proxy.wecom.local/cgi-bin/gettoken?corpid=corp-id&corpsecret=corp-secret"
    );
  });

  it("falls back to official api base url when apiBaseUrl is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ errcode: 0, access_token: "token-b" }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await getAccessToken(createAccount());

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=corp-id&corpsecret=corp-secret"
    );
  });

  it("uses configured apiBaseUrl for message send endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, access_token: "token-c" }))
      .mockResolvedValueOnce(mockJsonResponse({ errcode: 0, errmsg: "ok", msgid: "msg-1" }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await sendWecomAppMessage(createAccount("https://proxy.wecom.local"), { userId: "zhangsan" }, "hello");

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://proxy.wecom.local/cgi-bin/message/send?access_token=token-c");
  });
});
