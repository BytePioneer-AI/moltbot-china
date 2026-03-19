import os from "node:os";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { Socket } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendWechatMpActiveTextMock } = vi.hoisted(() => ({
  sendWechatMpActiveTextMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./send.js", async () => {
  const actual = await vi.importActual<typeof import("./send.js")>("./send.js");
  return {
    ...actual,
    sendWechatMpActiveText: sendWechatMpActiveTextMock,
  };
});

import { buildWechatMpXml, computeMsgSignature, computeSignature, encryptWechatMpMessage, parseWechatMpXml } from "./crypto.js";
import { flushWechatMpStateForTests, setWechatMpStateFilePathForTests } from "./state.js";
import { handleWechatMpWebhookRequest, registerWechatMpWebhookTarget } from "./webhook.js";
import { clearWechatMpRuntime, setWechatMpRuntime } from "./runtime.js";
import type { PluginConfig, ResolvedWechatMpAccount, WebhookTarget } from "./types.js";

const token = "callback-token";
const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const appId = "wx-test-appid";

function createMockRequest(params: {
  method: "GET" | "POST";
  url: string;
  rawBody?: string;
}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = params.method;
  req.url = params.url;
  if (params.method === "POST") {
    req.push(params.rawBody ?? "");
  }
  req.push(null);
  return req;
}

function createMockResponse(): ServerResponse & {
  _getData: () => string;
  _getStatusCode: () => number;
} {
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);
  const mutable = res as unknown as {
    write: (...args: unknown[]) => boolean;
    end: (...args: unknown[]) => ServerResponse;
  };
  let data = "";
  mutable.write = (chunk?: unknown) => {
    data += String(chunk ?? "");
    return true;
  };
  mutable.end = (chunk?: unknown) => {
    if (chunk) data += String(chunk);
    return res;
  };
  return Object.assign(res, {
    _getData: () => data,
    _getStatusCode: () => res.statusCode,
  });
}

function createAccount(overrides?: Partial<ResolvedWechatMpAccount>): ResolvedWechatMpAccount {
  return {
    accountId: "default",
    name: "WeChat MP (default)",
    enabled: true,
    configured: true,
    canSendActive: true,
    config: {
      appId,
      appSecret: "secret",
      token,
      encodingAESKey,
      webhookPath: "/wechat-mp",
      messageMode: "safe",
      replyMode: "passive",
    },
    ...overrides,
  };
}

function createTarget(params?: {
  account?: Partial<ResolvedWechatMpAccount>;
  cfg?: PluginConfig;
  path?: string;
}): WebhookTarget {
  const account = createAccount(params?.account);
  return {
    account,
    config: params?.cfg ?? {},
    runtime: {
      log: () => undefined,
      error: () => undefined,
    },
    path: params?.path ?? account.config.webhookPath ?? "/wechat-mp",
  };
}

function createEncryptedTextRequest(params?: {
  path?: string;
  content?: string;
  msgId?: string;
  openId?: string;
}) {
  const timestamp = "1710000000";
  const nonce = "nonce-post";
  const plaintext = buildWechatMpXml({
    ToUserName: appId,
    FromUserName: params?.openId ?? "openid-1",
    CreateTime: timestamp,
    MsgType: "text",
    Content: params?.content ?? "hello",
    MsgId: params?.msgId ?? "msg-1",
  });
  const encrypted = encryptWechatMpMessage({
    encodingAESKey,
    appId,
    plaintext,
  }).encrypt;
  const signature = computeMsgSignature({
    token,
    timestamp,
    nonce,
    encrypt: encrypted,
  });
  const rawBody = buildWechatMpXml({
    ToUserName: appId,
    Encrypt: encrypted,
    MsgSignature: signature,
    TimeStamp: timestamp,
    Nonce: nonce,
  });

  return createMockRequest({
    method: "POST",
    url: `${params?.path ?? "/wechat-mp"}?msg_signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
    rawBody,
  });
}

let tempDir = "";
let stateFilePath = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "wechat-mp-webhook-"));
  stateFilePath = path.join(tempDir, "state.json");
  setWechatMpStateFilePathForTests(stateFilePath);
});

afterEach(async () => {
  await flushWechatMpStateForTests();
  clearWechatMpRuntime();
  setWechatMpStateFilePathForTests();
  sendWechatMpActiveTextMock.mockReset();
  sendWechatMpActiveTextMock.mockResolvedValue({ ok: true });
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDir = "";
  stateFilePath = "";
});

describe("wechat-mp webhook", () => {
  it("handles GET webhook verification in plain mode", async () => {
    const unregister = registerWechatMpWebhookTarget(
      createTarget({
        account: {
          config: {
            appId,
            appSecret: "secret",
            token,
            webhookPath: "/wechat-mp-plain",
            messageMode: "plain",
            replyMode: "passive",
          },
        },
        path: "/wechat-mp-plain",
      })
    );

    try {
      const timestamp = "1710000000";
      const nonce = "nonce-verify";
      const echostr = "hello-echostr";
      const signature = computeSignature({ token, timestamp, nonce });
      const req = createMockRequest({
        method: "GET",
        url: `/wechat-mp-plain?signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}&echostr=${encodeURIComponent(echostr)}`,
      });
      const res = createMockResponse();

      const handled = await handleWechatMpWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe(echostr);
    } finally {
      unregister();
    }
  });

  it("handles GET webhook verification in safe mode without msg_signature by returning plain echostr", async () => {
    const unregister = registerWechatMpWebhookTarget(createTarget({ path: "/wechat-mp-get-safe" }));

    try {
      const timestamp = "1710000000";
      const nonce = "nonce-verify-safe-no-msgsig";
      const echostr = "783367174650329039";
      const signature = computeSignature({ token, timestamp, nonce });
      const req = createMockRequest({
        method: "GET",
        url: `/wechat-mp-get-safe?signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}&echostr=${encodeURIComponent(echostr)}`,
      });
      const res = createMockResponse();

      const handled = await handleWechatMpWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe(echostr);
    } finally {
      unregister();
    }
  });

  it("handles POST encrypted text message and ACKs success", async () => {
    const unregister = registerWechatMpWebhookTarget(createTarget());

    try {
      const timestamp = "1710000000";
      const nonce = "nonce-post";
      const plaintext = buildWechatMpXml({
        ToUserName: appId,
        FromUserName: "openid-1",
        CreateTime: "1710000000",
        MsgType: "text",
        Content: "hello",
        MsgId: "msg-1",
      });
      const encrypted = encryptWechatMpMessage({
        encodingAESKey,
        appId,
        plaintext,
      }).encrypt;
      const signature = computeMsgSignature({
        token,
        timestamp,
        nonce,
        encrypt: encrypted,
      });
      const rawBody = buildWechatMpXml({
        ToUserName: appId,
        Encrypt: encrypted,
        MsgSignature: signature,
        TimeStamp: timestamp,
        Nonce: nonce,
      });

      const req = createMockRequest({
        method: "POST",
        url: `/wechat-mp?msg_signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        rawBody,
      });
      const res = createMockResponse();

      const handled = await handleWechatMpWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe("success");
    } finally {
      unregister();
    }
  });

  it("rejects plain POST when signature is invalid", async () => {
    const unregister = registerWechatMpWebhookTarget(
      createTarget({
        account: {
          config: {
            appId,
            appSecret: "secret",
            token,
            webhookPath: "/wechat-mp-plain-post",
            messageMode: "plain",
            replyMode: "passive",
          },
        },
        path: "/wechat-mp-plain-post",
      })
    );

    try {
      const timestamp = "1710000000";
      const nonce = "nonce-plain-post";
      const rawBody = buildWechatMpXml({
        ToUserName: appId,
        FromUserName: "openid-plain",
        CreateTime: timestamp,
        MsgType: "text",
        Content: "hello",
        MsgId: "msg-plain",
      });
      const req = createMockRequest({
        method: "POST",
        url: `/wechat-mp-plain-post?signature=bad-signature&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        rawBody,
      });
      const res = createMockResponse();

      const handled = await handleWechatMpWebhookRequest(req, res);
      expect(handled).toBe(true);
      expect(res._getStatusCode()).toBe(401);
      expect(res._getData()).toBe("unauthorized");
    } finally {
      unregister();
    }
  });

  it("suppresses duplicate msgid via state dedupe", async () => {
    const unregister = registerWechatMpWebhookTarget(createTarget());

    try {
      const timestamp = "1710000000";
      const nonce = "nonce-post";
      const plaintext = buildWechatMpXml({
        ToUserName: appId,
        FromUserName: "openid-1",
        CreateTime: "1710000000",
        MsgType: "text",
        Content: "hello",
        MsgId: "msg-dup",
      });
      const encrypted = encryptWechatMpMessage({ encodingAESKey, appId, plaintext }).encrypt;
      const signature = computeMsgSignature({ token, timestamp, nonce, encrypt: encrypted });
      const rawBody = buildWechatMpXml({
        ToUserName: appId,
        Encrypt: encrypted,
        MsgSignature: signature,
        TimeStamp: timestamp,
        Nonce: nonce,
      });

      const req1 = createMockRequest({
        method: "POST",
        url: `/wechat-mp?msg_signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        rawBody,
      });
      const req2 = createMockRequest({
        method: "POST",
        url: `/wechat-mp?msg_signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        rawBody,
      });
      const res1 = createMockResponse();
      const res2 = createMockResponse();

      expect(await handleWechatMpWebhookRequest(req1, res1)).toBe(true);
      expect(await handleWechatMpWebhookRequest(req2, res2)).toBe(true);
      expect(res1._getData()).toBe("success");
      expect(res2._getData()).toBe("success");
    } finally {
      unregister();
    }
  });

  it("returns passive reply xml when runtime produces final text", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (params: {
      dispatcherOptions: { deliver: (payload: { text?: string }) => Promise<void> };
    }) => {
      await params.dispatcherOptions.deliver({ text: "final passive reply" });
    });
    setWechatMpRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: "default",
            agentId: "agent-1",
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher,
        },
        session: {
          resolveStorePath: () => "/tmp/session-store",
          readSessionUpdatedAt: () => null,
          recordInboundSession: async () => undefined,
        },
      },
    });

    const unregister = registerWechatMpWebhookTarget(createTarget());

    try {
      const timestamp = "1710000000";
      const nonce = "nonce-post-reply";
      const plaintext = buildWechatMpXml({
        ToUserName: appId,
        FromUserName: "openid-2",
        CreateTime: timestamp,
        MsgType: "text",
        Content: "hello",
        MsgId: "msg-reply",
      });
      const encrypted = encryptWechatMpMessage({ encodingAESKey, appId, plaintext }).encrypt;
      const signature = computeMsgSignature({ token, timestamp, nonce, encrypt: encrypted });
      const rawBody = buildWechatMpXml({
        ToUserName: appId,
        Encrypt: encrypted,
        MsgSignature: signature,
        TimeStamp: timestamp,
        Nonce: nonce,
      });

      const req = createMockRequest({
        method: "POST",
        url: `/wechat-mp?msg_signature=${encodeURIComponent(signature)}&timestamp=${encodeURIComponent(timestamp)}&nonce=${encodeURIComponent(nonce)}`,
        rawBody,
      });
      const res = createMockResponse();

      expect(await handleWechatMpWebhookRequest(req, res)).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toContain("<xml>");
      const parsed = parseWechatMpXml(res._getData());
      expect(parsed.Encrypt).toBeTruthy();
      expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });

  it("records slash command as command-authorized context", async () => {
    const recordInboundSession = vi.fn(async () => undefined);
    setWechatMpRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: "default",
            agentId: "agent-1",
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(async () => undefined),
        },
        session: {
          resolveStorePath: () => "/tmp/session-store",
          readSessionUpdatedAt: () => null,
          recordInboundSession,
        },
      },
    });

    const unregister = registerWechatMpWebhookTarget(createTarget());

    try {
      const req = createEncryptedTextRequest({ content: "/verbose on", msgId: "msg-command" });
      const res = createMockResponse();

      expect(await handleWechatMpWebhookRequest(req, res)).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe("success");
      expect(recordInboundSession).toHaveBeenCalledTimes(1);
      const recordCall = (recordInboundSession as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as
        | { ctx?: { CommandBody?: string; CommandAuthorized?: boolean } }
        | undefined;
      expect(recordCall?.ctx?.CommandBody).toBe("/verbose on");
      expect(recordCall?.ctx?.CommandAuthorized).toBe(true);
    } finally {
      unregister();
    }
  });

  it("ignores split delivery config in passive mode", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (params: {
      dispatcherOptions: { deliver: (payload: { text?: string }) => Promise<void> };
    }) => {
      await params.dispatcherOptions.deliver({ text: "passive final reply" });
    });
    setWechatMpRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: "default",
            agentId: "agent-1",
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher,
        },
        session: {
          resolveStorePath: () => "/tmp/session-store",
          readSessionUpdatedAt: () => null,
          recordInboundSession: async () => undefined,
        },
      },
    });

    const unregister = registerWechatMpWebhookTarget(
      createTarget({
        account: {
          config: {
            appId,
            appSecret: "secret",
            token,
            encodingAESKey,
            webhookPath: "/wechat-mp-passive-split",
            messageMode: "safe",
            replyMode: "passive",
            activeDeliveryMode: "split",
          },
        },
        path: "/wechat-mp-passive-split",
      })
    );

    try {
      const req = createEncryptedTextRequest({ path: "/wechat-mp-passive-split", msgId: "msg-passive-split" });
      const res = createMockResponse();

      expect(await handleWechatMpWebhookRequest(req, res)).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toContain("<xml>");
      expect(sendWechatMpActiveTextMock).not.toHaveBeenCalled();
      expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });

  it("sends one merged active message in active merged mode", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (params: {
      dispatcherOptions: { deliver: (payload: { text?: string }) => Promise<void> };
    }) => {
      await params.dispatcherOptions.deliver({ text: "step 1" });
      await params.dispatcherOptions.deliver({ text: "step 2" });
    });
    setWechatMpRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: "default",
            agentId: "agent-1",
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher,
        },
        session: {
          resolveStorePath: () => "/tmp/session-store",
          readSessionUpdatedAt: () => null,
          recordInboundSession: async () => undefined,
        },
      },
    });

    const unregister = registerWechatMpWebhookTarget(
      createTarget({
        account: {
          config: {
            appId,
            appSecret: "secret",
            token,
            encodingAESKey,
            webhookPath: "/wechat-mp-active-merged",
            messageMode: "safe",
            replyMode: "active",
            activeDeliveryMode: "merged",
          },
        },
        path: "/wechat-mp-active-merged",
      })
    );

    try {
      const req = createEncryptedTextRequest({ path: "/wechat-mp-active-merged", msgId: "msg-active-merged" });
      const res = createMockResponse();

      expect(await handleWechatMpWebhookRequest(req, res)).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe("success");
      expect(sendWechatMpActiveTextMock).toHaveBeenCalledTimes(1);
      expect(sendWechatMpActiveTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          toUserName: "openid-1",
          text: "step 1\n\nstep 2",
        })
      );
    } finally {
      unregister();
    }
  });

  it("sends one active message per chunk in active split mode", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async (params: {
      dispatcherOptions: { deliver: (payload: { text?: string }) => Promise<void> };
    }) => {
      await params.dispatcherOptions.deliver({ text: "log 1" });
      await params.dispatcherOptions.deliver({ text: "log 2" });
    });
    setWechatMpRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: "default",
            agentId: "agent-1",
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher,
        },
        session: {
          resolveStorePath: () => "/tmp/session-store",
          readSessionUpdatedAt: () => null,
          recordInboundSession: async () => undefined,
        },
      },
    });

    const unregister = registerWechatMpWebhookTarget(
      createTarget({
        account: {
          config: {
            appId,
            appSecret: "secret",
            token,
            encodingAESKey,
            webhookPath: "/wechat-mp-active-split",
            messageMode: "safe",
            replyMode: "active",
            activeDeliveryMode: "split",
          },
        },
        path: "/wechat-mp-active-split",
      })
    );

    try {
      const req = createEncryptedTextRequest({ path: "/wechat-mp-active-split", msgId: "msg-active-split" });
      const res = createMockResponse();

      expect(await handleWechatMpWebhookRequest(req, res)).toBe(true);
      expect(res._getStatusCode()).toBe(200);
      expect(res._getData()).toBe("success");
      await vi.waitFor(() => {
        expect(sendWechatMpActiveTextMock).toHaveBeenCalledTimes(2);
      });
      expect(sendWechatMpActiveTextMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ toUserName: "openid-1", text: "log 1" })
      );
      expect(sendWechatMpActiveTextMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ toUserName: "openid-1", text: "log 2" })
      );
    } finally {
      unregister();
    }
  });
});
