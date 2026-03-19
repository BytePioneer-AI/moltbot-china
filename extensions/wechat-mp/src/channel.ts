import {
  DEFAULT_ACCOUNT_ID,
  listWechatMpAccountIds,
  resolveAllowFrom,
  resolveDefaultWechatMpAccountId,
  resolveWechatMpAccount,
} from "./config.js";
import { wechatMpOnboardingAdapter } from "./onboarding.js";
import { wechatMpOutbound } from "./outbound.js";
import { probeWechatMpAccount } from "./probe.js";
import { getAccountState, updateAccountState } from "./state.js";
import { registerWechatMpWebhookTarget } from "./webhook.js";
import { setWechatMpRuntime } from "./runtime.js";
import type { PluginConfig, ResolvedWechatMpAccount, WechatMpConfig } from "./types.js";

export { DEFAULT_ACCOUNT_ID } from "./config.js";
export type { ResolvedWechatMpAccount } from "./types.js";

type ParsedDirectTarget = {
  accountId?: string;
  openId: string;
};

const unregisterHooks = new Map<string, () => void>();

/**
 * Parse a direct target string into accountId and openId components.
 * Supports formats: "wechat-mp:user:<openId>@<accountId>", "user:<openId>@<accountId>", "<openId>@<accountId>"
 */
function parseDirectTarget(rawTarget: string): ParsedDirectTarget | null {
  let raw = String(rawTarget ?? "").trim();
  if (!raw) return null;

  if (/^wechat-mp:/i.test(raw)) {
    raw = raw.slice("wechat-mp:".length);
  }

  let accountId: string | undefined;
  const atIndex = raw.lastIndexOf("@");
  if (atIndex > 0 && atIndex < raw.length - 1) {
    accountId = raw.slice(atIndex + 1).trim();
    raw = raw.slice(0, atIndex);
  }

  if (/^user:/i.test(raw)) {
    raw = raw.slice("user:".length);
  }

  const openId = raw.trim();
  return openId ? { accountId, openId } : null;
}

/**
 * JSON Schema for wechat-mp configuration validation.
 */
const wechatMpConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    name: { type: "string" },
    defaultAccount: { type: "string" },
    appId: { type: "string" },
    appSecret: { type: "string" },
    encodingAESKey: { type: "string" },
    token: { type: "string" },
    webhookPath: { type: "string" },
    messageMode: { type: "string", enum: ["plain", "safe", "compat"] },
    replyMode: { type: "string", enum: ["passive", "active"] },
    activeDeliveryMode: { type: "string", enum: ["merged", "split"] },
    welcomeText: { type: "string" },
    dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist", "disabled"] },
    allowFrom: { type: "array", items: { type: "string" } },
    accounts: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          enabled: { type: "boolean" },
          appId: { type: "string" },
          appSecret: { type: "string" },
          encodingAESKey: { type: "string" },
          token: { type: "string" },
          webhookPath: { type: "string" },
          messageMode: { type: "string", enum: ["plain", "safe", "compat"] },
          replyMode: { type: "string", enum: ["passive", "active"] },
          activeDeliveryMode: { type: "string", enum: ["merged", "split"] },
          welcomeText: { type: "string" },
          dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist", "disabled"] },
          allowFrom: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

/**
 * Plugin metadata for display and identification.
 */
const meta = {
  id: "wechat-mp",
  label: "WeChat MP",
  selectionLabel: "WeChat Official Account (微信公众号)",
  docsPath: "/channels/wechat-mp",
  docsLabel: "wechat-mp",
  blurb: "微信公众号渠道，支持关注用户通过公众号与 AI 交互",
  aliases: ["weixin-mp", "微信公众号", "公众号"],
  order: 81,
} as const;

/**
 * WeChat MP ChannelPlugin composition root skeleton.
 * Provides the complete plugin surface for host registration.
 */
export const wechatMpPlugin = {
  id: "wechat-mp",

  meta: { ...meta },

  capabilities: {
    chatTypes: ["direct"] as const,
    media: false,
    reactions: false,
    threads: false,
    edit: false,
    reply: true,
    polls: false,
    activeSend: true,
  },

  messaging: {
    normalizeTarget: (raw: string): string | undefined => {
      const parsed = parseDirectTarget(raw);
      return parsed ? `user:${parsed.openId}${parsed.accountId ? `@${parsed.accountId}` : ""}` : undefined;
    },
    targetResolver: {
      looksLikeId: (raw: string, normalized?: string) => Boolean(parseDirectTarget(normalized ?? raw)),
      hint: "Use openid only: user:<openid> (optional @accountId).",
    },
    formatTargetDisplay: (params: { target: string; display?: string }) => {
      const parsed = parseDirectTarget(params.target);
      return parsed ? `user:${parsed.openId}` : params.display?.trim() || params.target;
    },
  },

  configSchema: {
    schema: wechatMpConfigSchema,
  },

  reload: { configPrefixes: ["channels.wechat-mp"] },

  onboarding: wechatMpOnboardingAdapter,

  config: {
    listAccountIds: (cfg: PluginConfig): string[] => listWechatMpAccountIds(cfg),
    resolveAccount: (cfg: PluginConfig, accountId?: string): ResolvedWechatMpAccount =>
      resolveWechatMpAccount({ cfg, accountId }),
    defaultAccountId: (cfg: PluginConfig): string => resolveDefaultWechatMpAccountId(cfg),
    setAccountEnabled: (params: {
      cfg: PluginConfig;
      accountId?: string;
      enabled: boolean;
    }): PluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const existing = (params.cfg.channels?.["wechat-mp"] ?? {}) as WechatMpConfig;
      const hasDedicatedAccount = Boolean(existing.accounts?.[accountId]);

      if (!hasDedicatedAccount || accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...params.cfg,
          channels: {
            ...params.cfg.channels,
            "wechat-mp": {
              ...existing,
              enabled: params.enabled,
            } as WechatMpConfig,
          },
        };
      }

      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          "wechat-mp": {
            ...existing,
            accounts: {
              ...(existing.accounts ?? {}),
              [accountId]: {
                ...(existing.accounts?.[accountId] ?? {}),
                enabled: params.enabled,
              },
            },
          } as WechatMpConfig,
        },
      };
    },
    deleteAccount: (params: { cfg: PluginConfig; accountId?: string }): PluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const existing = (params.cfg.channels?.["wechat-mp"] ?? undefined) as WechatMpConfig | undefined;
      if (!existing) return params.cfg;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...params.cfg,
          channels: {
            ...params.cfg.channels,
            "wechat-mp": {
              ...existing,
              enabled: false,
            } as WechatMpConfig,
          },
        };
      }

      const nextAccounts = { ...(existing.accounts ?? {}) };
      delete nextAccounts[accountId];
      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          "wechat-mp": {
            ...existing,
            accounts: Object.keys(nextAccounts).length > 0 ? nextAccounts : undefined,
          } as WechatMpConfig,
        },
      };
    },
    isConfigured: (account: ResolvedWechatMpAccount): boolean => account.configured,
    describeAccount: (account: ResolvedWechatMpAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      canSendActive: account.canSendActive,
      webhookPath: account.config.webhookPath ?? "/wechat-mp",
    }),
    resolveAllowFrom: (params: { cfg: PluginConfig; accountId?: string }): string[] =>
      resolveAllowFrom(resolveWechatMpAccount({ cfg: params.cfg, accountId: params.accountId }).config),
    formatAllowFrom: (params: { allowFrom: (string | number)[] }): string[] =>
      params.allowFrom
        .map((entry) => String(entry).trim().toLowerCase())
        .filter(Boolean),
  },

  setup: {
    resolveAccountId: (params: { cfg: PluginConfig; accountId?: string }): string =>
      params.accountId?.trim() || resolveDefaultWechatMpAccountId(params.cfg),
    applyAccountConfig: (params: {
      cfg: PluginConfig;
      accountId?: string;
      config?: Record<string, unknown>;
    }): PluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const existing = (params.cfg.channels?.["wechat-mp"] ?? {}) as WechatMpConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...params.cfg,
          channels: {
            ...params.cfg.channels,
            "wechat-mp": {
              ...existing,
              ...params.config,
              enabled: true,
            } as WechatMpConfig,
          },
        };
      }

      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          "wechat-mp": {
            ...existing,
            enabled: true,
            accounts: {
              ...(existing.accounts ?? {}),
              [accountId]: {
                ...(existing.accounts?.[accountId] ?? {}),
                ...params.config,
                enabled: true,
              },
            },
          } as WechatMpConfig,
        },
      };
    },
  },

  directory: {
    canResolve: (params: { target: string }) => Boolean(parseDirectTarget(params.target)),
    resolveTarget: (params: { cfg: PluginConfig; target: string }) => {
      const parsed = parseDirectTarget(params.target);
      return parsed
        ? {
            channel: "wechat-mp",
            accountId: parsed.accountId,
            to: parsed.openId,
          }
        : null;
    },
    resolveTargets: (params: { cfg: PluginConfig; targets: string[] }) => {
      const results: Array<{ channel: string; accountId?: string; to: string }> = [];
      for (const target of params.targets) {
        const resolved = wechatMpPlugin.directory.resolveTarget({ cfg: params.cfg, target });
        if (resolved) {
          results.push(resolved);
        }
      }
      return results;
    },
    getTargetFormats: () => ["wechat-mp:user:<openid>", "user:<openid>", "<openid>"],
  },

  outbound: wechatMpOutbound,

  gateway: {
    startAccount: async (ctx: {
      cfg: PluginConfig;
      runtime?: unknown;
      abortSignal?: AbortSignal;
      accountId: string;
      setStatus?: (status: Record<string, unknown>) => void;
      log?: { info: (message: string) => void; error: (message: string) => void };
    }): Promise<void> => {
      const account = resolveWechatMpAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
      const path = (account.config.webhookPath ?? "/wechat-mp").trim() || "/wechat-mp";

      const runtimeCandidate = ctx.runtime as {
        channel?: {
          routing?: { resolveAgentRoute?: unknown };
          reply?: { dispatchReplyWithBufferedBlockDispatcher?: unknown };
        };
      } | undefined;

      if (
        runtimeCandidate?.channel?.routing?.resolveAgentRoute &&
        runtimeCandidate.channel.reply?.dispatchReplyWithBufferedBlockDispatcher
      ) {
        setWechatMpRuntime(ctx.runtime as Record<string, unknown>);
      }

      ctx.log?.info?.(`[wechat-mp] account ${account.accountId} starting webhook ingress`);

      const registerTarget = {
        account,
        config: ctx.cfg,
        runtime: {
          log: ctx.log?.info ?? console.log,
          error: ctx.log?.error ?? console.error,
        },
        path,
        statusSink: (patch: Record<string, unknown>) =>
          ctx.setStatus?.({ accountId: account.accountId, ...patch }),
      };
      const unregister = registerWechatMpWebhookTarget(registerTarget);
      const previous = unregisterHooks.get(account.accountId);
      if (previous) previous();
      unregisterHooks.set(account.accountId, unregister);

      const lastStartAt = Date.now();
      await updateAccountState(account.accountId, {
        running: true,
        configured: account.configured,
        webhookPath: path,
        lastStartAt,
      });
      const state = await getAccountState(account.accountId);
      ctx.setStatus?.({
        accountId: account.accountId,
        running: true,
        configured: account.configured,
        canSendActive: account.canSendActive,
        webhookPath: path,
        lastInboundAt: state.lastInboundAt,
        lastStartAt,
      });

      if (ctx.abortSignal) {
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    },
    stopAccount: async (ctx: {
      accountId: string;
      setStatus?: (status: Record<string, unknown>) => void;
    }): Promise<void> => {
      const unregister = unregisterHooks.get(ctx.accountId);
      if (unregister) {
        unregister();
        unregisterHooks.delete(ctx.accountId);
      }
      const lastStopAt = Date.now();
      await updateAccountState(ctx.accountId, { running: false, lastStopAt });
      ctx.setStatus?.({ accountId: ctx.accountId, running: false, lastStopAt });
    },
    getStatus: () => ({ connected: true }),
  },

  status: {
    probeAccount: async (params: { cfg: PluginConfig; accountId?: string }) =>
      probeWechatMpAccount({ cfg: params.cfg, accountId: params.accountId }),
  },
};
