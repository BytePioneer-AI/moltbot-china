/**
 * 企业微信客户渠道配置 - 单元测试
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  normalizeAccountId,
  listWecomKhAccountIds,
  resolveDefaultWecomKhAccountId,
  resolveWecomKhAccount,
  listEnabledWecomKhAccounts,
  resolveDmPolicy,
  resolveAllowFrom,
  resolveApiBaseUrl,
  DEFAULT_ACCOUNT_ID,
  type PluginConfig,
} from "../config.js";

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("normalizeAccountId", () => {
    it("应返回 'default' 当输入为空时", () => {
      expect(normalizeAccountId("")).toBe(DEFAULT_ACCOUNT_ID);
      expect(normalizeAccountId(null)).toBe(DEFAULT_ACCOUNT_ID);
      expect(normalizeAccountId(undefined)).toBe(DEFAULT_ACCOUNT_ID);
      expect(normalizeAccountId("  ")).toBe(DEFAULT_ACCOUNT_ID);
    });

    it("应保留非空值并去除空白", () => {
      expect(normalizeAccountId("  my-account  ")).toBe("my-account");
    });
  });

  describe("listWecomKhAccountIds", () => {
    it("无 accounts 时应返回默认账户", () => {
      const cfg: PluginConfig = {};
      expect(listWecomKhAccountIds(cfg)).toEqual([DEFAULT_ACCOUNT_ID]);
    });

    it("应列出所有已配置的账户 ID 并排序", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            accounts: {
              beta: {},
              alpha: {},
            },
          },
        },
      };
      expect(listWecomKhAccountIds(cfg)).toEqual(["alpha", "beta"]);
    });
  });

  describe("resolveDefaultWecomKhAccountId", () => {
    it("应使用显式指定的 defaultAccount", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            defaultAccount: "my-kh",
            accounts: {
              "my-kh": {},
            },
          },
        },
      };
      expect(resolveDefaultWecomKhAccountId(cfg)).toBe("my-kh");
    });

    it("无 defaultAccount 时应返回第一个账户", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            accounts: {
              beta: {},
              alpha: {},
            },
          },
        },
      };
      expect(resolveDefaultWecomKhAccountId(cfg)).toBe("alpha");
    });
  });

  describe("resolveWecomKhAccount", () => {
    it("应从环境变量回退默认账户配置", () => {
      process.env.WECOM_KH_CORP_ID = "env-corp-id";
      process.env.WECOM_KH_SECRET = "env-kh-secret";
      process.env.WECOM_KH_OPEN_KFID = "wkEnvKfId";
      process.env.WECOM_KH_TOKEN = "env-token";
      process.env.WECOM_KH_ENCODING_AES_KEY = "env-aes-key";

      const cfg: PluginConfig = {};
      const account = resolveWecomKhAccount({ cfg });

      expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
      expect(account.corpId).toBe("env-corp-id");
      expect(account.khSecret).toBe("env-kh-secret");
      expect(account.openKfId).toBe("wkEnvKfId");
      expect(account.agentId).toBe("wkEnvKfId");
      expect(account.token).toBe("env-token");
      expect(account.canSend).toBe(true);
    });

    it("应合并顶层配置和账户级配置", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            corpId: "my-corp",
            khSecret: "global-secret",
            token: "global-token",
            encodingAESKey: "global-aes",
            accounts: {
              "kh-1": {
                khSecret: "override-secret",
                openKfId: "wkOverride",
              },
            },
          },
        },
      };

      const account = resolveWecomKhAccount({ cfg, accountId: "kh-1" });
      expect(account.corpId).toBe("my-corp");
      expect(account.khSecret).toBe("override-secret");
      expect(account.openKfId).toBe("wkOverride");
      expect(account.agentId).toBe("wkOverride");
      expect(account.token).toBe("global-token");
      expect(account.canSend).toBe(true);
    });

    it("应兼容旧字段 agentId", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            corpId: "my-corp",
            khSecret: "global-secret",
            agentId: "wkLegacy",
            token: "global-token",
            encodingAESKey: "global-aes",
          },
        },
      };

      const account = resolveWecomKhAccount({ cfg });
      expect(account.openKfId).toBe("wkLegacy");
      expect(account.agentId).toBe("wkLegacy");
      expect(account.canSend).toBe(true);
    });

    it("缺少关键配置时 canSend 应为 false", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            corpId: "my-corp",
            token: "token",
            encodingAESKey: "key",
          },
        },
      };

      const account = resolveWecomKhAccount({ cfg });
      expect(account.canSend).toBe(false);
    });

    it("enabled 为 false 时账户应被禁用", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            enabled: false,
            corpId: "corp",
            khSecret: "secret",
            openKfId: "wkId",
            token: "t",
            encodingAESKey: "k",
          },
        },
      };

      const account = resolveWecomKhAccount({ cfg });
      expect(account.enabled).toBe(false);
    });
  });

  describe("listEnabledWecomKhAccounts", () => {
    it("应只返回启用的账户", () => {
      const cfg: PluginConfig = {
        channels: {
          "wecom-kh": {
            token: "t",
            encodingAESKey: "k",
            accounts: {
              a: { enabled: true },
              b: { enabled: false },
              c: {},
            },
          },
        },
      };

      const enabled = listEnabledWecomKhAccounts(cfg);
      expect(enabled.length).toBe(2);
      expect(enabled.map((a) => a.accountId).sort()).toEqual(["a", "c"]);
    });
  });

  describe("resolveDmPolicy", () => {
    it("默认应为 'open'", () => {
      expect(resolveDmPolicy({})).toBe("open");
    });

    it("应使用显式指定的策略", () => {
      expect(resolveDmPolicy({ dmPolicy: "pairing" })).toBe("pairing");
      expect(resolveDmPolicy({ dmPolicy: "disabled" })).toBe("disabled");
    });
  });

  describe("resolveAllowFrom", () => {
    it("默认应为空列表", () => {
      expect(resolveAllowFrom({})).toEqual([]);
    });

    it("应返回配置的允许列表", () => {
      expect(resolveAllowFrom({ allowFrom: ["wmUser1", "wmUser2"] })).toEqual(["wmUser1", "wmUser2"]);
    });
  });

  describe("resolveApiBaseUrl", () => {
    it("默认应为企微官方 API 地址", () => {
      expect(resolveApiBaseUrl({})).toBe("https://qyapi.weixin.qq.com");
    });

    it("应使用自定义地址并移除末尾斜杠", () => {
      expect(resolveApiBaseUrl({ apiBaseUrl: "https://proxy.example.com/" })).toBe("https://proxy.example.com");
    });
  });
});
