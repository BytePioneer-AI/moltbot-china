import { describe, expect, it } from "vitest";
import { QQBotConfigSchema, resolveQQBotASRCredentials, resolveQQBotCredentials } from "./config.js";

describe("QQBotConfigSchema", () => {
  it("applies media defaults", () => {
    const cfg = QQBotConfigSchema.parse({});
    expect(cfg.maxFileSizeMB).toBe(100);
    expect(cfg.mediaTimeoutMs).toBe(30000);
    expect(cfg.markdownSupport).toBe(true);
  });

  it("rejects invalid media constraints", () => {
    expect(() => QQBotConfigSchema.parse({ maxFileSizeMB: 0 })).toThrow();
    expect(() => QQBotConfigSchema.parse({ mediaTimeoutMs: 0 })).toThrow();
  });

  it("coerces numeric appId values to strings", () => {
    const cfg = QQBotConfigSchema.parse({
      appId: 102824485,
      clientSecret: "secret",
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
    expect(cfg.asr?.appId).toBe("123456");
    expect(cfg.accounts?.main?.appId).toBe("987654321");
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
