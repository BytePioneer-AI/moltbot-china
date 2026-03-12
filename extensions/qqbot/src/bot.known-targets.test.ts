import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQQBotRuntime, setQQBotRuntime } from "./runtime.js";

const outboundMocks = vi.hoisted(() => ({
  sendTyping: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
}));

const proactiveMocks = vi.hoisted(() => ({
  upsertKnownQQBotTarget: vi.fn(),
}));

vi.mock("./outbound.js", () => ({
  qqbotOutbound: {
    sendTyping: outboundMocks.sendTyping,
    sendText: outboundMocks.sendText,
    sendMedia: outboundMocks.sendMedia,
  },
}));

vi.mock("./proactive.js", () => ({
  upsertKnownQQBotTarget: proactiveMocks.upsertKnownQQBotTarget,
}));

import { handleQQBotDispatch } from "./bot.js";

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function setupSessionRuntime(params?: {
  routeResolver?: (input: {
    cfg: unknown;
    channel: string;
    accountId?: string;
    peer: { kind: string; id: string };
  }) => { sessionKey: string; accountId: string; agentId?: string };
  dispatchReplyWithBufferedBlockDispatcher?: ReturnType<typeof vi.fn>;
}) {
  const readSessionUpdatedAt = vi.fn().mockReturnValue(null);
  const recordInboundSession = vi.fn().mockResolvedValue(undefined);
  const dispatchReplyWithBufferedBlockDispatcher =
    params?.dispatchReplyWithBufferedBlockDispatcher ?? vi.fn().mockResolvedValue(undefined);

  setQQBotRuntime({
    channel: {
      routing: {
        resolveAgentRoute:
          params?.routeResolver ??
          ((input) => ({
            sessionKey: "shared-session",
            accountId: input.accountId ?? "default",
            agentId: "main",
          })),
      },
      reply: {
        finalizeInboundContext: (ctx: unknown) => ctx,
        dispatchReplyWithBufferedBlockDispatcher,
      },
      session: {
        resolveStorePath: () => "memory://qqbot",
        readSessionUpdatedAt,
        recordInboundSession,
      },
    },
  });

  return {
    readSessionUpdatedAt,
    recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher,
  };
}

const baseCfg = {
  channels: {
    qqbot: {
      enabled: true,
      appId: "app-1",
      clientSecret: "secret-1",
    },
  },
};

describe("QQBot inbound known-target recording", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outboundMocks.sendTyping.mockResolvedValue({ channel: "qqbot" });
    outboundMocks.sendText.mockResolvedValue({ channel: "qqbot", messageId: "m-1", timestamp: 1 });
    outboundMocks.sendMedia.mockResolvedValue({ channel: "qqbot", messageId: "m-2", timestamp: 2 });
    setQQBotRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: "default",
            agentId: "main",
          }),
        },
        reply: {},
      },
    });
  });

  afterEach(() => {
    clearQQBotRuntime();
  });

  it("records canonical user targets for allowed C2C messages", async () => {
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-1",
        content: "hello",
        timestamp: 1700000000000,
        author: {
          user_openid: "u-123",
          username: "Alice",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(proactiveMocks.upsertKnownQQBotTarget).toHaveBeenCalledWith({
      target: {
        accountId: "default",
        kind: "user",
        target: "user:u-123",
        displayName: "Alice",
        sourceChatType: "direct",
        firstSeenAt: 1700000000000,
        lastSeenAt: 1700000000000,
      },
    });
  });

  it("records canonical group targets for allowed group messages", async () => {
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "GROUP_AT_MESSAGE_CREATE",
      eventData: {
        id: "msg-2",
        content: "hello group",
        timestamp: 1700000000100,
        group_openid: "g-456",
        author: {
          member_openid: "member-1",
          nickname: "Team Owner",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(proactiveMocks.upsertKnownQQBotTarget).toHaveBeenCalledWith({
      target: {
        accountId: "default",
        kind: "group",
        target: "group:g-456",
        displayName: "Team Owner",
        sourceChatType: "group",
        firstSeenAt: 1700000000100,
        lastSeenAt: 1700000000100,
      },
    });
  });

  it("records canonical channel targets for allowed channel messages", async () => {
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "AT_MESSAGE_CREATE",
      eventData: {
        id: "msg-3",
        content: "hello channel",
        timestamp: 1700000000200,
        channel_id: "channel-789",
        guild_id: "guild-1",
        author: {
          id: "author-1",
          username: "Channel Owner",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(proactiveMocks.upsertKnownQQBotTarget).toHaveBeenCalledWith({
      target: {
        accountId: "default",
        kind: "channel",
        target: "channel:channel-789",
        displayName: "Channel Owner",
        sourceChatType: "channel",
        firstSeenAt: 1700000000200,
        lastSeenAt: 1700000000200,
      },
    });
  });

  it("does not record targets when the inbound message is blocked by policy", async () => {
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-4",
        content: "blocked",
        timestamp: 1700000000300,
        author: {
          user_openid: "u-blocked",
          username: "Blocked User",
        },
      },
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            dmPolicy: "allowlist",
            allowFrom: ["u-allowed"],
          },
        },
      },
      accountId: "default",
      logger,
    });

    expect(proactiveMocks.upsertKnownQQBotTarget).not.toHaveBeenCalled();
  });

  it("does not record DIRECT_MESSAGE_CREATE events into known targets", async () => {
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "DIRECT_MESSAGE_CREATE",
      eventData: {
        id: "msg-5",
        content: "dm hello",
        timestamp: 1700000000400,
        guild_id: "guild-2",
        author: {
          id: "dm-user-1",
          username: "DM User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(proactiveMocks.upsertKnownQQBotTarget).not.toHaveBeenCalled();
  });

  it("serializes concurrent dispatches for the same resolved session", async () => {
    const logger = createLogger();
    let activeDispatches = 0;
    let maxActiveDispatches = 0;
    let resolveFirstEntered: (() => void) | undefined;
    let releaseFirstDispatch: (() => void) | undefined;

    const firstEntered = new Promise<void>((resolve) => {
      resolveFirstEntered = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirstDispatch = resolve;
    });

    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {
      activeDispatches += 1;
      maxActiveDispatches = Math.max(maxActiveDispatches, activeDispatches);

      if (dispatchReplyWithBufferedBlockDispatcher.mock.calls.length === 1) {
        resolveFirstEntered?.();
        await firstRelease;
      }

      activeDispatches -= 1;
    });

    setQQBotRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "shared-session",
            accountId: "default",
            agentId: "main",
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher,
        },
      },
    });

    const firstDispatch = handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-serial-1",
        content: "first",
        timestamp: 1700000000500,
        author: {
          user_openid: "u-serial",
          username: "Serial User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    await firstEntered;

    const secondDispatch = handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-serial-2",
        content: "second",
        timestamp: 1700000000600,
        author: {
          user_openid: "u-serial",
          username: "Serial User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("session busy; queueing inbound dispatch sessionKey=qqbot:dm:default:u-serial")
    );

    releaseFirstDispatch?.();

    await Promise.all([firstDispatch, secondDispatch]);

    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(2);
    expect(maxActiveDispatches).toBe(1);
  });
});

describe("QQBot direct session isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outboundMocks.sendTyping.mockResolvedValue({ channel: "qqbot" });
    outboundMocks.sendText.mockResolvedValue({ channel: "qqbot", messageId: "m-1", timestamp: 1 });
    outboundMocks.sendMedia.mockResolvedValue({ channel: "qqbot", messageId: "m-2", timestamp: 2 });
  });

  afterEach(() => {
    clearQQBotRuntime();
  });

  it("uses per-user direct session keys for different C2C users", async () => {
    const logger = createLogger();
    const sessionRuntime = setupSessionRuntime();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-user-1",
        content: "hello one",
        timestamp: 1700000001000,
        author: {
          user_openid: "u-100",
          username: "User One",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-user-2",
        content: "hello two",
        timestamp: 1700000002000,
        author: {
          user_openid: "u-200",
          username: "User Two",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(sessionRuntime.readSessionUpdatedAt).toHaveBeenNthCalledWith(1, {
      storePath: "memory://qqbot",
      sessionKey: "qqbot:dm:default:u-100",
    });
    expect(sessionRuntime.readSessionUpdatedAt).toHaveBeenNthCalledWith(2, {
      storePath: "memory://qqbot",
      sessionKey: "qqbot:dm:default:u-200",
    });
    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionKey: "qqbot:dm:default:u-100",
        updateLastRoute: expect.objectContaining({
          sessionKey: "qqbot:dm:default:u-100",
        }),
      })
    );
    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionKey: "qqbot:dm:default:u-200",
        updateLastRoute: expect.objectContaining({
          sessionKey: "qqbot:dm:default:u-200",
        }),
      })
    );
    expect(
      sessionRuntime.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0]?.[0]?.ctx?.SessionKey
    ).toBe("qqbot:dm:default:u-100");
    expect(
      sessionRuntime.dispatchReplyWithBufferedBlockDispatcher.mock.calls[1]?.[0]?.ctx?.SessionKey
    ).toBe("qqbot:dm:default:u-200");
  });

  it("keeps a stable direct session key for repeated messages from the same user", async () => {
    const logger = createLogger();
    const sessionRuntime = setupSessionRuntime();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-stable-1",
        content: "first",
        timestamp: 1700000003000,
        author: {
          user_openid: "u-stable",
          username: "Stable User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-stable-2",
        content: "second",
        timestamp: 1700000004000,
        author: {
          user_openid: "u-stable",
          username: "Stable User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(sessionRuntime.readSessionUpdatedAt).toHaveBeenCalledTimes(2);
    expect(sessionRuntime.readSessionUpdatedAt).toHaveBeenNthCalledWith(1, {
      storePath: "memory://qqbot",
      sessionKey: "qqbot:dm:default:u-stable",
    });
    expect(sessionRuntime.readSessionUpdatedAt).toHaveBeenNthCalledWith(2, {
      storePath: "memory://qqbot",
      sessionKey: "qqbot:dm:default:u-stable",
    });
    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionKey: "qqbot:dm:default:u-stable",
      })
    );
    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionKey: "qqbot:dm:default:u-stable",
      })
    );
  });

  it("isolates the same direct sender across different qqbot accounts", async () => {
    const logger = createLogger();
    const sessionRuntime = setupSessionRuntime({
      routeResolver: (input) => ({
        sessionKey: "shared-direct-session",
        accountId: input.accountId ?? "default",
        agentId: "main",
      }),
    });
    const multiAccountCfg = {
      channels: {
        qqbot: {
          ...baseCfg.channels.qqbot,
          accounts: {
            bot2: {
              enabled: true,
              appId: "app-2",
              clientSecret: "secret-2",
            },
          },
        },
      },
    };

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-account-1",
        content: "hello default",
        timestamp: 1700000005000,
        author: {
          user_openid: "u-same",
          username: "Same User",
        },
      },
      cfg: multiAccountCfg,
      accountId: "default",
      logger,
    });

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-account-2",
        content: "hello bot2",
        timestamp: 1700000006000,
        author: {
          user_openid: "u-same",
          username: "Same User",
        },
      },
      cfg: multiAccountCfg,
      accountId: "bot2",
      logger,
    });

    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionKey: "qqbot:dm:default:u-same",
      })
    );
    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionKey: "qqbot:dm:bot2:u-same",
      })
    );
  });

  it("keeps group and channel session keys from routing", async () => {
    const logger = createLogger();
    const sessionRuntime = setupSessionRuntime({
      routeResolver: (input) => {
        if (input.peer.id.startsWith("group:")) {
          return { sessionKey: "route-group-session", accountId: input.accountId ?? "default", agentId: "main" };
        }
        if (input.peer.id.startsWith("channel:")) {
          return { sessionKey: "route-channel-session", accountId: input.accountId ?? "default", agentId: "main" };
        }
        return { sessionKey: "route-direct-session", accountId: input.accountId ?? "default", agentId: "main" };
      },
    });

    await handleQQBotDispatch({
      eventType: "GROUP_AT_MESSAGE_CREATE",
      eventData: {
        id: "msg-group-session",
        content: "hello group",
        timestamp: 1700000007000,
        group_openid: "g-route",
        author: {
          member_openid: "member-route",
          nickname: "Route Group User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    await handleQQBotDispatch({
      eventType: "AT_MESSAGE_CREATE",
      eventData: {
        id: "msg-channel-session",
        content: "hello channel",
        timestamp: 1700000008000,
        channel_id: "channel-route",
        guild_id: "guild-route",
        author: {
          id: "channel-user",
          username: "Route Channel User",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionKey: "route-group-session",
      })
    );
    expect(sessionRuntime.recordInboundSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionKey: "route-channel-session",
      })
    );
  });

  it("allows concurrent direct dispatches for different users even when routing returns the same session", async () => {
    const logger = createLogger();
    let activeDispatches = 0;
    let maxActiveDispatches = 0;
    let enteredDispatches = 0;
    let resolveBothEntered: (() => void) | undefined;
    let releaseDispatches: (() => void) | undefined;

    const bothEntered = new Promise<void>((resolve) => {
      resolveBothEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDispatches = resolve;
    });

    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {
      activeDispatches += 1;
      enteredDispatches += 1;
      maxActiveDispatches = Math.max(maxActiveDispatches, activeDispatches);

      if (enteredDispatches === 2) {
        resolveBothEntered?.();
      }

      await release;
      activeDispatches -= 1;
    });

    setupSessionRuntime({
      dispatchReplyWithBufferedBlockDispatcher,
    });

    const firstDispatch = handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-parallel-1",
        content: "hello first user",
        timestamp: 1700000009000,
        author: {
          user_openid: "u-parallel-1",
          username: "Parallel User One",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    const secondDispatch = handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-parallel-2",
        content: "hello second user",
        timestamp: 1700000010000,
        author: {
          user_openid: "u-parallel-2",
          username: "Parallel User Two",
        },
      },
      cfg: baseCfg,
      accountId: "default",
      logger,
    });

    await bothEntered;

    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(2);
    expect(activeDispatches).toBe(2);

    releaseDispatches?.();

    await Promise.all([firstDispatch, secondDispatch]);

    expect(maxActiveDispatches).toBe(2);
  });
});
