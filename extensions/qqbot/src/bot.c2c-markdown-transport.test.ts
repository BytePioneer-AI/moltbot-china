import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQQBotRuntime, setQQBotRuntime } from "./runtime.js";

const outboundMocks = vi.hoisted(() => ({
  sendTyping: vi.fn(),
  sendText: vi.fn(),
  sendMedia: vi.fn(),
}));

const proactiveMocks = vi.hoisted(() => ({
  getKnownQQBotTarget: vi.fn(),
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
  getKnownQQBotTarget: proactiveMocks.getKnownQQBotTarget,
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

function createTempImageFile(): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "qqbot-c2c-markdown-"));
  const filePath = join(dir, "evidence.png");
  writeFileSync(filePath, "image");
  return { dir, filePath };
}

function createPngProbeBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer[0] = 0x89;
  buffer[1] = 0x50;
  buffer[2] = 0x4e;
  buffer[3] = 0x47;
  buffer[4] = 0x0d;
  buffer[5] = 0x0a;
  buffer[6] = 0x1a;
  buffer[7] = 0x0a;
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function createArrayBufferView(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function installReplyRuntime(
  payloads: Array<{ text?: string; mediaUrl?: string; mediaUrls?: string[]; kind?: string }>,
  textApi?: {
    resolveMarkdownTableMode?: (params: { cfg: unknown; channel: string; accountId?: string }) => unknown;
    convertMarkdownTables?: (text: string, mode: unknown) => string;
    chunkTextWithMode?: (text: string, limit: number, mode: unknown) => string[];
    chunkMarkdownText?: (text: string, limit: number) => string[];
    resolveChunkMode?: (cfg: unknown, channel: string) => unknown;
  }
): void {
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
    for (const payload of payloads) {
      await dispatcherOptions.deliver(payload, { kind: payload.kind ?? "final" });
    }
  });

  setQQBotRuntime({
    channel: {
      routing: {
        resolveAgentRoute: () => ({
          sessionKey: "session-1",
          accountId: "default",
          agentId: "main",
        }),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
      },
      ...(textApi ? { text: textApi } : {}),
    },
  });
}

const baseCfg = {
  channels: {
    qqbot: {
      enabled: true,
      appId: "app-1",
      clientSecret: "secret-1",
      markdownSupport: true,
    },
  },
};

describe("QQBot C2C markdown transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outboundMocks.sendTyping.mockResolvedValue({ channel: "qqbot" });
    outboundMocks.sendText.mockResolvedValue({ channel: "qqbot", messageId: "text-1", timestamp: 1 });
    outboundMocks.sendMedia.mockResolvedValue({ channel: "qqbot", messageId: "media-1", timestamp: 2 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const buffer = createPngProbeBuffer(640, 480);
        return {
          ok: true,
          status: 206,
          arrayBuffer: async () => createArrayBufferView(buffer),
        };
      })
    );
  });

  afterEach(() => {
    clearQQBotRuntime();
    vi.unstubAllGlobals();
  });

  it("keeps c2c table replies and appended http image markdown in one proactive send", async () => {
    installReplyRuntime([
      {
        text: "| col1 | col2 |\n| --- | --- |\n| a | b |\n\nhttps://example.com/table.png",
      },
    ]);
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-table-1",
        event_id: "evt-table-1",
        content: "hello",
        timestamp: 1700000000000,
        author: {
          user_openid: "u-table-1",
          username: "Alice",
        },
      },
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            c2cMarkdownDeliveryMode: "proactive-table-only",
          },
        },
      },
      accountId: "default",
      logger,
    });

    expect(outboundMocks.sendMedia).not.toHaveBeenCalled();
    expect(outboundMocks.sendText).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendText).toHaveBeenCalledWith({
      accountId: "default",
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            c2cMarkdownDeliveryMode: "proactive-table-only",
          },
        },
      },
      to: "user:u-table-1",
      text:
        "| col1 | col2 |\n| --- | --- |\n| a | b |\n\n![#640px #480px](https://example.com/table.png)",
      replyToId: undefined,
      replyEventId: undefined,
    });
    expect(
      logger.info.mock.calls.some(([message]) =>
        String(message).includes("delivery=c2c-markdown-proactive")
      )
    ).toBe(true);
    expect(
      logger.info.mock.calls.some(([message]) =>
        String(message).includes("delivery=c2c-markdown-proactive") &&
        String(message).includes("segment=1/1 chunk=1/1") &&
        String(message).includes("phase=buffered")
      )
    ).toBe(true);
  });

  it("keeps mixed c2c table markdown in a single proactive send", async () => {
    installReplyRuntime([
      {
        text:
          "# 标题\n\n> 引用\n\n| col1 | col2 |\n| --- | --- |\n| a | b |\n\n---\n\n- item",
      },
    ]);
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-mixed-1",
        event_id: "evt-mixed-1",
        content: "hello",
        timestamp: 1700000000001,
        author: {
          user_openid: "u-mixed-1",
          username: "Alice",
        },
      },
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            c2cMarkdownDeliveryMode: "proactive-all",
          },
        },
      },
      accountId: "default",
      logger,
    });

    expect(outboundMocks.sendText).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendText).toHaveBeenCalledWith({
      accountId: "default",
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            c2cMarkdownDeliveryMode: "proactive-all",
          },
        },
      },
      to: "user:u-mixed-1",
      text: "# 标题\n\n> 引用\n\n| col1 | col2 |\n| --- | --- |\n| a | b |\n\n---\n\n- item",
      replyToId: undefined,
      replyEventId: undefined,
    });
  });

  it("keeps assistant notes interleaved with verbose c2c markdown payloads", async () => {
    installReplyRuntime([
      { text: "我先说明一下当前进展。", kind: "block" },
      { text: "✉️ Message", kind: "tool" },
      { text: "我继续处理这个请求。", kind: "block" },
      { text: "🧹 Auto-compaction complete (count 8).", kind: "tool" },
      { text: "我把这张图重新发你一遍。", kind: "final" },
    ]);
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-verbose-1",
        event_id: "evt-verbose-1",
        content: "hello",
        timestamp: 1700000000002,
        author: {
          user_openid: "u-verbose-1",
          username: "Alice",
        },
      },
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            c2cMarkdownDeliveryMode: "proactive-all",
          },
        },
      },
      accountId: "default",
      logger,
    });

    expect(outboundMocks.sendText).toHaveBeenCalledTimes(5);
    expect(outboundMocks.sendText.mock.calls.map((call) => call[0]?.text)).toEqual([
      "我先说明一下当前进展。",
      "✉️ Message",
      "我继续处理这个请求。",
      "🧹 Auto-compaction complete (count 8).",
      "我把这张图重新发你一遍。",
    ]);
    expect(
      logger.info.mock.calls.some(([message]) =>
        String(message).includes("delivery=c2c-markdown-proactive") &&
        String(message).includes("phase=immediate")
      )
    ).toBe(true);
  });

  it("keeps raw markdown for c2c transport even when framework table conversion is enabled", async () => {
    const convertMarkdownTables = vi.fn((text: string) =>
      text
        .replace(/^# /gm, "")
        .replace(/^> /gm, "")
        .replace(/^- /gm, "? ")
        .replace(/^---$/gm, "───")
    );
    installReplyRuntime(
      [
        {
          text: "# 标题\n\n> 引用第一行\n\n- 列表 A\n\n---\n\n| col1 | col2 |\n| --- | --- |\n| a | b |",
        },
      ],
      {
        resolveMarkdownTableMode: () => "code",
        convertMarkdownTables,
        resolveChunkMode: () => "length",
      }
    );
    const logger = createLogger();

    await handleQQBotDispatch({
      eventType: "C2C_MESSAGE_CREATE",
      eventData: {
        id: "msg-raw-md-1",
        event_id: "evt-raw-md-1",
        content: "hello",
        timestamp: 1700000000002,
        author: {
          user_openid: "u-raw-md-1",
          username: "Alice",
        },
      },
      cfg: {
        channels: {
          qqbot: {
            ...baseCfg.channels.qqbot,
            c2cMarkdownDeliveryMode: "proactive-all",
          },
        },
      },
      accountId: "default",
      logger,
    });

    expect(convertMarkdownTables).not.toHaveBeenCalled();
    expect(outboundMocks.sendText.mock.calls.map((call) => call[0].text)).toEqual([
      "# 标题\n\n> 引用第一行\n\n- 列表 A\n\n---\n\n| col1 | col2 |\n| --- | --- |\n| a | b |",
    ]);
  });

  it("uses proactive transport for c2c markdown with local media", async () => {
    const { dir, filePath } = createTempImageFile();
    installReplyRuntime([
      {
        text: `# 标题\n\nhttps://example.com/remote.png\n\n${filePath}`,
      },
    ]);
    const logger = createLogger();

    try {
      await handleQQBotDispatch({
        eventType: "C2C_MESSAGE_CREATE",
        eventData: {
          id: "msg-proactive-1",
          event_id: "evt-proactive-1",
          content: "hello",
          timestamp: 1700000000100,
          author: {
            user_openid: "u-proactive-1",
            username: "Bob",
          },
        },
        cfg: {
          channels: {
            qqbot: {
              ...baseCfg.channels.qqbot,
              c2cMarkdownDeliveryMode: "proactive-all",
            },
          },
        },
        accountId: "default",
        logger,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(outboundMocks.sendMedia).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendMedia).toHaveBeenCalledWith({
      accountId: "default",
      cfg: { channels: { qqbot: expect.any(Object) } },
      to: "user:u-proactive-1",
      mediaUrl: filePath,
      replyToId: undefined,
      replyEventId: undefined,
    });
    expect(outboundMocks.sendText).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendText).toHaveBeenCalledWith({
      accountId: "default",
      cfg: { channels: { qqbot: expect.any(Object) } },
      to: "user:u-proactive-1",
      text: "# 标题\n\n![#640px #480px](https://example.com/remote.png)",
      replyToId: undefined,
      replyEventId: undefined,
    });
    expect(outboundMocks.sendMedia.mock.invocationCallOrder[0]).toBeLessThan(
      outboundMocks.sendText.mock.invocationCallOrder[0]
    );
  });

  it("keeps passive reply refs for c2c markdown transport in passive mode", async () => {
    const { dir, filePath } = createTempImageFile();
    installReplyRuntime([
      {
        text: `普通段落\n\n${filePath}`,
      },
    ]);
    const logger = createLogger();

    try {
      await handleQQBotDispatch({
        eventType: "C2C_MESSAGE_CREATE",
        eventData: {
          id: "msg-passive-1",
          event_id: "evt-passive-1",
          content: "hello",
          timestamp: 1700000000200,
          author: {
            user_openid: "u-passive-1",
            username: "Carol",
          },
        },
        cfg: {
          channels: {
            qqbot: {
              ...baseCfg.channels.qqbot,
              c2cMarkdownDeliveryMode: "passive",
            },
          },
        },
        accountId: "default",
        logger,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(outboundMocks.sendMedia).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendMedia).toHaveBeenCalledWith({
      accountId: "default",
      cfg: { channels: { qqbot: expect.any(Object) } },
      to: "user:u-passive-1",
      mediaUrl: filePath,
      replyToId: "msg-passive-1",
      replyEventId: "evt-passive-1",
    });
    expect(outboundMocks.sendText).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendText).toHaveBeenCalledWith({
      accountId: "default",
      cfg: { channels: { qqbot: expect.any(Object) } },
      to: "user:u-passive-1",
      text: "普通段落",
      replyToId: "msg-passive-1",
      replyEventId: "evt-passive-1",
    });
    expect(
      logger.info.mock.calls.some(([message]) =>
        String(message).includes("delivery=c2c-markdown-passive")
      )
    ).toBe(true);
  });

  it("keeps group delivery behavior unchanged", async () => {
    const { dir, filePath } = createTempImageFile();
    installReplyRuntime([
      {
        text: `| col1 | col2 |\n| --- | --- |\n| a | b |\n\n${filePath}`,
      },
    ]);
    const logger = createLogger();

    try {
      await handleQQBotDispatch({
        eventType: "GROUP_AT_MESSAGE_CREATE",
        eventData: {
          id: "msg-group-1",
          content: "hello",
          timestamp: 1700000000300,
          group_openid: "g-1",
          author: {
            member_openid: "member-1",
            nickname: "Team Owner",
          },
        },
        cfg: {
          channels: {
            qqbot: {
              ...baseCfg.channels.qqbot,
              c2cMarkdownDeliveryMode: "proactive-all",
            },
          },
        },
        accountId: "default",
        logger,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(outboundMocks.sendText).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendText).toHaveBeenCalledWith({
      accountId: "default",
      cfg: { channels: { qqbot: expect.any(Object) } },
      to: "group:g-1",
      text: "| col1 | col2 |\n| --- | --- |\n| a | b |",
      replyToId: "msg-group-1",
      replyEventId: undefined,
    });
    expect(outboundMocks.sendMedia).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendMedia).toHaveBeenCalledWith({
      accountId: "default",
      cfg: { channels: { qqbot: expect.any(Object) } },
      to: "group:g-1",
      mediaUrl: filePath,
      replyToId: "msg-group-1",
      replyEventId: undefined,
    });
  });

  it("does not echo local paths when c2c local media delivery fails", async () => {
    const { dir, filePath } = createTempImageFile();
    installReplyRuntime([
      {
        text: `说明文字\n\n${filePath}`,
      },
    ]);
    outboundMocks.sendMedia.mockResolvedValueOnce({ channel: "qqbot", error: "upload failed" });
    const logger = createLogger();

    try {
      await handleQQBotDispatch({
        eventType: "C2C_MESSAGE_CREATE",
        eventData: {
          id: "msg-local-fail-1",
          event_id: "evt-local-fail-1",
          content: "hello",
          timestamp: 1700000000400,
          author: {
            user_openid: "u-local-fail-1",
            username: "Dana",
          },
        },
        cfg: {
          channels: {
            qqbot: {
              ...baseCfg.channels.qqbot,
              c2cMarkdownDeliveryMode: "passive",
            },
          },
        },
        accountId: "default",
        logger,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(outboundMocks.sendText).toHaveBeenCalledTimes(1);
    expect(outboundMocks.sendText.mock.calls[0]?.[0]?.text).toBe("说明文字");
    expect(outboundMocks.sendText.mock.calls[0]?.[0]?.text).not.toContain(filePath);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("sendMedia failed"));
  });
});
