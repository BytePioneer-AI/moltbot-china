import { describe, expect, it } from "vitest";

import {
  buildWecomDispatchConfig,
  DEFAULT_WECOM_BLOCK_STREAM_COALESCE_IDLE_MS,
  DEFAULT_WECOM_BLOCK_STREAM_COALESCE_MAX_CHARS,
  DEFAULT_WECOM_BLOCK_STREAM_COALESCE_MIN_CHARS,
  DEFAULT_WECOM_TEXT_CHUNK_LIMIT,
  DEFAULT_WECOM_WS_HEARTBEAT_MS,
  DEFAULT_WECOM_WS_RECONNECT_INITIAL_MS,
  DEFAULT_WECOM_WS_RECONNECT_MAX_MS,
  DEFAULT_WECOM_WS_URL,
  resolveWecomAccount,
} from "./config.js";

describe("resolveWecomAccount", () => {
  it("defaults to ws mode when mode is omitted", () => {
    const account = resolveWecomAccount({
      cfg: {
        channels: {
          wecom: {
            botId: "bot-1",
            secret: "secret-1",
          },
        },
      },
    });

    expect(account.mode).toBe("ws");
    expect(account.configured).toBe(true);
    expect(account.botId).toBe("bot-1");
    expect(account.secret).toBe("secret-1");
  });

  it("keeps webhook mode only when explicitly configured", () => {
    const account = resolveWecomAccount({
      cfg: {
        channels: {
          wecom: {
            mode: "webhook",
            token: "token-1",
            encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDE",
          },
        },
      },
    });

    expect(account.mode).toBe("webhook");
    expect(account.configured).toBe(true);
    expect(account.token).toBe("token-1");
    expect(account.botId).toBeUndefined();
  });

  it("resolves ws mode credentials and defaults", () => {
    const account = resolveWecomAccount({
      cfg: {
        channels: {
          wecom: {
            mode: "ws",
            botId: "bot-123",
            secret: "secret-xyz",
          },
        },
      },
    });

    expect(account.mode).toBe("ws");
    expect(account.configured).toBe(true);
    expect(account.botId).toBe("bot-123");
    expect(account.secret).toBe("secret-xyz");
    expect(account.wsUrl).toBe(DEFAULT_WECOM_WS_URL);
    expect(account.heartbeatIntervalMs).toBe(DEFAULT_WECOM_WS_HEARTBEAT_MS);
    expect(account.reconnectInitialDelayMs).toBe(DEFAULT_WECOM_WS_RECONNECT_INITIAL_MS);
    expect(account.reconnectMaxDelayMs).toBe(DEFAULT_WECOM_WS_RECONNECT_MAX_MS);
    expect(account.wsImageReplyMode).toBe("native");
  });

  it("resolves ws image reply mode override", () => {
    const account = resolveWecomAccount({
      cfg: {
        channels: {
          wecom: {
            mode: "ws",
            botId: "bot-123",
            secret: "secret-xyz",
            wsImageReplyMode: "markdown-url",
          },
        },
      },
    });

    expect(account.wsImageReplyMode).toBe("markdown-url");
  });

  it("injects aggressive streaming defaults into dispatch config", () => {
    const dispatchCfg = buildWecomDispatchConfig({
      cfg: {
        channels: {
          wecom: {
            botId: "bot-123",
            secret: "secret-xyz",
          },
        },
      },
      accountId: "default",
    });

    expect(dispatchCfg.channels?.wecom?.textChunkLimit).toBe(DEFAULT_WECOM_TEXT_CHUNK_LIMIT);
    expect(dispatchCfg.channels?.wecom?.blockStreaming).toBe(true);
    expect(dispatchCfg.channels?.wecom?.blockStreamingCoalesce).toEqual({
      minChars: DEFAULT_WECOM_BLOCK_STREAM_COALESCE_MIN_CHARS,
      maxChars: DEFAULT_WECOM_BLOCK_STREAM_COALESCE_MAX_CHARS,
      idleMs: DEFAULT_WECOM_BLOCK_STREAM_COALESCE_IDLE_MS,
    });
  });

  it("deep merges account-level coalesce overrides for dispatch config", () => {
    const dispatchCfg = buildWecomDispatchConfig({
      cfg: {
        channels: {
          wecom: {
            blockStreamingCoalesce: {
              minChars: 160,
              maxChars: 280,
            },
            accounts: {
              zhugeliang: {
                botId: "bot-123",
                secret: "secret-xyz",
                blockStreamingCoalesce: {
                  idleMs: 120,
                },
              },
            },
          },
        },
      },
      accountId: "zhugeliang",
    });

    expect(dispatchCfg.channels?.wecom?.accounts?.zhugeliang?.blockStreamingCoalesce).toEqual({
      minChars: 160,
      maxChars: 280,
      idleMs: 120,
    });
  });
});
