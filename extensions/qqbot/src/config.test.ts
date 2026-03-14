import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QQBotConfigSchema,
  mergeQQBotAccountConfig,
  resolveInboundMediaDir,
  resolveInboundMediaKeepDays,
  resolveQQBotAutoSendLocalPathMedia,
  resolveQQBotASRCredentials,
  resolveQQBotCredentials,
} from "./config.js";

describe("QQBotConfigSchema", () => {
  it("applies media defaults", () => {
    const cfg = QQBotConfigSchema.parse({});
    expect(cfg.maxFileSizeMB).toBe(100);
    expect(cfg.mediaTimeoutMs).toBe(30000);
    expect(cfg.markdownSupport).toBe(true);
    expect(cfg.c2cMarkdownDeliveryMode).toBe("proactive-table-only");
    expect(cfg.c2cMarkdownChunkStrategy).toBe("markdown-block");
    expect(cfg.longTaskNoticeDelayMs).toBe(30000);
    expect(resolveQQBotAutoSendLocalPathMedia(cfg)).toBe(true);
    expect(resolveInboundMediaDir(cfg)).toBe(join(homedir(), ".openclaw", "media", "qqbot", "inbound"));
    expect(resolveInboundMediaKeepDays(cfg)).toBe(7);
  });

  it("rejects invalid media constraints", () => {
    expect(() => QQBotConfigSchema.parse({ maxFileSizeMB: 0 })).toThrow();
    expect(() => QQBotConfigSchema.parse({ mediaTimeoutMs: 0 })).toThrow();
    expect(() => QQBotConfigSchema.parse({ longTaskNoticeDelayMs: -1 })).toThrow();
    expect(() => QQBotConfigSchema.parse({ c2cMarkdownDeliveryMode: "invalid" })).toThrow();
    expect(() => QQBotConfigSchema.parse({ c2cMarkdownChunkStrategy: "invalid" })).toThrow();
  });

  it("resolves custom inbound media settings", () => {
    const cfg = QQBotConfigSchema.parse({
      autoSendLocalPathMedia: false,
      inboundMedia: {
        dir: "C:\\custom\\qqbot-media",
        keepDays: 3,
      },
    });

    expect(resolveQQBotAutoSendLocalPathMedia(cfg)).toBe(false);
    expect(resolveInboundMediaDir(cfg)).toBe("C:\\custom\\qqbot-media");
    expect(resolveInboundMediaKeepDays(cfg)).toBe(3);
  });

  it("coerces numeric appId values to strings", () => {
    const cfg = QQBotConfigSchema.parse({
      appId: 102824485,
      clientSecret: "secret",
      displayAliases: {
        "user:u-top": "Top Alias",
      },
      asr: {
        enabled: true,
        appId: 123456,
        secretId: "sid",
        secretKey: "skey",
      },
      accounts: {
        main: {
          appId: 987654321,
          clientSecret: "child-secret",
          displayAliases: {
            "user:u-child": "Child Alias",
          },
          asr: {
            enabled: true,
            appId: 654321,
            secretId: "child-sid",
            secretKey: "child-skey",
          },
        },
      },
    });

    expect(cfg.appId).toBe("102824485");
    expect(cfg.displayAliases).toEqual({
      "user:u-top": "Top Alias",
    });
    expect(cfg.asr?.appId).toBe("123456");
    expect(cfg.accounts?.main?.appId).toBe("987654321");
    expect(cfg.accounts?.main?.displayAliases).toEqual({
      "user:u-child": "Child Alias",
    });
    expect(cfg.accounts?.main?.asr?.appId).toBe("654321");
  });

  it("resolves ASR credentials only when enabled and complete", () => {
    const disabled = QQBotConfigSchema.parse({
      asr: {
        enabled: false,
        appId: "app",
        secretId: "sid",
        secretKey: "skey",
      },
    });
    expect(resolveQQBotASRCredentials(disabled)).toBeUndefined();

    const missingSecret = QQBotConfigSchema.parse({
      asr: {
        enabled: true,
        appId: "app",
        secretId: "sid",
      },
    });
    expect(resolveQQBotASRCredentials(missingSecret)).toBeUndefined();

    const enabled = QQBotConfigSchema.parse({
      asr: {
        enabled: true,
        appId: " app ",
        secretId: " sid ",
        secretKey: " skey ",
      },
    });
    expect(resolveQQBotASRCredentials(enabled)).toEqual({
      appId: "app",
      secretId: "sid",
      secretKey: "skey",
    });
  });

  it("merges displayAliases with account-level overrides", () => {
    const merged = mergeQQBotAccountConfig(
      {
        channels: {
          qqbot: {
            displayAliases: {
              "user:u-top": "Top Alias",
              "user:u-shared": "Shared Top",
            },
            accounts: {
              main: {
                displayAliases: {
                  "user:u-main": "Main Alias",
                  "user:u-shared": "Shared Main",
                },
              },
            },
          },
        },
      },
      "main"
    );

    expect(merged.displayAliases).toEqual({
      "user:u-top": "Top Alias",
      "user:u-shared": "Shared Main",
      "user:u-main": "Main Alias",
    });
  });

  it("allows account-level override for markdown chunk strategy", () => {
    const merged = mergeQQBotAccountConfig(
      {
        channels: {
          qqbot: {
            c2cMarkdownChunkStrategy: "length",
            accounts: {
              main: {
                c2cMarkdownChunkStrategy: "markdown-block",
              },
            },
          },
        },
      },
      "main"
    );

    expect(merged.c2cMarkdownChunkStrategy).toBe("markdown-block");
  });

  it("normalizes runtime numeric credentials without schema parse", () => {
    const raw = {
      appId: 102824485,
      clientSecret: " secret ",
      asr: {
        enabled: true,
        appId: 1393190525,
        secretId: " sid ",
        secretKey: " skey ",
      },
    };

    const credentials = resolveQQBotCredentials(raw as never);
    expect(credentials).toEqual({
      appId: "102824485",
      clientSecret: "secret",
    });

    const asrCredentials = resolveQQBotASRCredentials(raw as never);
    expect(asrCredentials).toEqual({
      appId: "1393190525",
      secretId: "sid",
      secretKey: "skey",
    });
  });
});
