import { describe, expect, it, vi } from "vitest";

import { dispatchWechatMpCandidate } from "./dispatch.js";
import type { PluginConfig, PluginRuntime, ResolvedWechatMpAccount, WechatMpInboundCandidate } from "./types.js";

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
      dmPolicy: "open",
    },
    ...overrides,
  };
}

function createRuntime(replyTexts: string[] = ["reply text"]) {
  const resolveAgentRoute = vi.fn(() => ({
    sessionKey: "session-1",
    accountId: "default",
    agentId: "agent-1",
  }));
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (params: { dispatcherOptions: { deliver: (payload: { text?: string }) => Promise<void> } }) => {
    for (const text of replyTexts) {
      await params.dispatcherOptions.deliver({ text });
    }
  });
  const recordInboundSession = vi.fn(async () => undefined);
  const readSessionUpdatedAt = vi.fn(() => null);
  const resolveStorePath = vi.fn(() => "/tmp/session-store");

  const runtime: PluginRuntime = {
    channel: {
      routing: { resolveAgentRoute },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
      },
      session: {
        resolveStorePath,
        readSessionUpdatedAt,
        recordInboundSession,
      },
    },
  };

  return {
    runtime,
    resolveAgentRoute,
    dispatchReplyWithBufferedBlockDispatcher,
    recordInboundSession,
  };
}

function createTextCandidate(): WechatMpInboundCandidate {
  return {
    accountId: "default",
    openId: "openid-1",
    appId: "wx-test-appid",
    target: "user:openid-1@default",
    sessionKey: "dm:wx-test-appid:openid-1",
    createTime: 1710000000,
    msgType: "text",
    msgId: "msg-1",
    dedupeKey: "msg-1",
    encrypted: true,
    hasUserIntent: true,
    content: "hello",
    toUserName: "gh_xxx",
    raw: {
      ToUserName: "gh_xxx",
      FromUserName: "openid-1",
      CreateTime: 1710000000,
      MsgType: "text",
      Content: "hello",
      MsgId: "msg-1",
    },
  };
}

function createEventCandidate(intentful: boolean): WechatMpInboundCandidate {
  return {
    accountId: "default",
    openId: "openid-1",
    appId: "wx-test-appid",
    target: "user:openid-1@default",
    sessionKey: "dm:wx-test-appid:openid-1",
    createTime: 1710000000,
    msgType: "event",
    dedupeKey: `event:${intentful ? "click" : "view"}`,
    encrypted: true,
    hasUserIntent: intentful,
    event: intentful ? "click" : "view",
    eventKey: intentful ? "MENU_KEY" : "https://example.com",
    toUserName: "gh_xxx",
    raw: {
      ToUserName: "gh_xxx",
      FromUserName: "openid-1",
      CreateTime: 1710000000,
      MsgType: "event",
      Event: intentful ? "CLICK" : "VIEW",
      EventKey: intentful ? "MENU_KEY" : "https://example.com",
    } as never,
  };
}

describe("wechat-mp dispatch", () => {
  it("dispatches text candidate into runtime mainline", async () => {
    const account = createAccount();
    const { runtime, resolveAgentRoute, dispatchReplyWithBufferedBlockDispatcher, recordInboundSession } = createRuntime();

    const result = await dispatchWechatMpCandidate({
      cfg: {} as PluginConfig,
      account,
      candidate: createTextCandidate(),
      runtime,
    });

    expect(result.dispatched).toBe(true);
    expect(result.combinedReply).toBe("reply text");
    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(recordInboundSession).toHaveBeenCalledTimes(1);
    const calls = (recordInboundSession as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const recordCall = calls[0]?.[0] as
      | { sessionKey?: string; ctx?: { SessionKey?: string; CommandAuthorized?: boolean } }
      | undefined;
    expect(recordCall?.sessionKey).toBe("session-1");
    expect(recordCall?.ctx?.SessionKey).toBe("session-1");
    expect(recordCall?.ctx?.CommandAuthorized).toBe(true);
  });

  it("skips non-intentful event candidate", async () => {
    const account = createAccount();
    const { runtime, resolveAgentRoute, dispatchReplyWithBufferedBlockDispatcher } = createRuntime();

    const result = await dispatchWechatMpCandidate({
      cfg: {} as PluginConfig,
      account,
      candidate: createEventCandidate(false),
      runtime,
    });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("non-intentful event");
    expect(resolveAgentRoute).not.toHaveBeenCalled();
    expect(dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("dispatches intentful event candidate", async () => {
    const account = createAccount();
    const { runtime, resolveAgentRoute, dispatchReplyWithBufferedBlockDispatcher } = createRuntime();

    const result = await dispatchWechatMpCandidate({
      cfg: {} as PluginConfig,
      account,
      candidate: createEventCandidate(true),
      runtime,
    });

    expect(result.dispatched).toBe(true);
    expect(resolveAgentRoute).toHaveBeenCalledTimes(1);
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
  });

  it("merges delivered chunks by default", async () => {
    const account = createAccount();
    const { runtime } = createRuntime(["step 1", "step 2"]);

    const result = await dispatchWechatMpCandidate({
      cfg: {} as PluginConfig,
      account,
      candidate: createTextCandidate(),
      runtime,
    });

    expect(result.combinedReply).toBe("step 1\n\nstep 2");
  });

  it("forwards chunks one by one in split mode", async () => {
    const account = createAccount();
    const { runtime } = createRuntime(["step 1", "", "step 2"]);
    const onChunk = vi.fn(async () => undefined);

    const result = await dispatchWechatMpCandidate({
      cfg: {} as PluginConfig,
      account,
      candidate: createTextCandidate(),
      runtime,
      onChunk,
    });

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk).toHaveBeenNthCalledWith(1, "step 1");
    expect(onChunk).toHaveBeenNthCalledWith(2, "step 2");
    expect(result.combinedReply).toBe("");
  });
});
