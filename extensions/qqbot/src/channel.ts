/**
 * QQ Bot ChannelPlugin 实现
 */

import type { ResolvedQQBotAccount, QQBotConfig } from "./types.js";
import { QQBotConfigSchema, isConfigured, resolveQQBotCredentials } from "./config.js";
import { qqbotOutbound } from "./outbound.js";
import { monitorQQBotProvider, stopQQBotMonitor } from "./monitor.js";
import { setQQBotRuntime } from "./runtime.js";

export const DEFAULT_ACCOUNT_ID = "default";

const meta = {
  id: "qqbot",
  label: "QQ Bot",
  selectionLabel: "QQ Bot",
  docsPath: "/channels/qqbot",
  docsLabel: "qqbot",
  blurb: "QQ 开放平台机器人消息",
  aliases: ["qq"],
  order: 72,
} as const;

interface PluginConfig {
  channels?: {
    qqbot?: QQBotConfig;
  };
}

function resolveQQBotAccount(params: {
  cfg: PluginConfig;
  accountId?: string;
}): ResolvedQQBotAccount {
  const { cfg, accountId = DEFAULT_ACCOUNT_ID } = params;
  const qqCfg = cfg.channels?.qqbot;
  const parsed = qqCfg ? QQBotConfigSchema.safeParse(qqCfg) : null;
  const config = parsed?.success ? parsed.data : undefined;
  const credentials = resolveQQBotCredentials(config);
  const configured = Boolean(credentials);

  return {
    accountId,
    enabled: config?.enabled ?? true,
    configured,
    appId: credentials?.appId,
    markdownSupport: config?.markdownSupport ?? true,
  };
}

export const qqbotPlugin = {
  id: "qqbot",

  meta: {
    ...meta,
  },

  capabilities: {
    chatTypes: ["direct", "channel"] as const,
    media: true,
    reactions: false,
    threads: false,
    edit: false,
    reply: true,
    polls: false,
    blockStreaming: false,
  },

  messaging: {
    normalizeTarget: (raw: string): string | undefined => {
      const trimmed = raw.trim();
      if (!trimmed) return undefined;
      let value = trimmed;
      if (/^qqbot:/i.test(value)) {
        value = value.slice("qqbot:".length);
      }
      if (/^(user|group|channel):/i.test(value)) {
        return value;
      }
      if (value.startsWith("@")) {
        const next = value.slice(1).trim();
        return next ? `user:${next}` : undefined;
      }
      if (value.startsWith("#")) {
        const next = value.slice(1).trim();
        return next ? `group:${next}` : undefined;
      }
      const compact = value.replace(/\s+/g, "");
      if (/^[a-zA-Z0-9]{8,}$/.test(compact)) {
        return `user:${compact}`;
      }
      return value;
    },
    targetResolver: {
      looksLikeId: (raw: string, normalized?: string) => {
        const candidate = (normalized ?? raw).trim();
        if (!candidate) return false;
        if (/^(user|group|channel):/i.test(candidate)) return true;
        if (/^[@#]/.test(raw.trim())) return true;
        return /^[a-zA-Z0-9]{8,}$/.test(candidate);
      },
      hint: "Use user:<openid> for C2C, group:<group_openid> for groups, channel:<channel_id> for QQ channels.",
    },
    formatTargetDisplay: (params: {
      target: string;
      display?: string;
      kind?: "user" | "group" | "channel";
    }) => {
      const { target, display, kind } = params;
      if (display?.trim()) {
        const trimmed = display.trim();
        if (trimmed.startsWith("@") || trimmed.startsWith("#")) {
          return trimmed;
        }
        if (kind === "user") return `@${trimmed}`;
        if (kind === "group" || kind === "channel") return `#${trimmed}`;
        return trimmed;
      }
      return target;
    },
  },

  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        appId: { type: "string" },
        clientSecret: { type: "string" },
        asr: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            appId: { type: "string" },
            secretId: { type: "string" },
            secretKey: { type: "string" },
          },
        },
        markdownSupport: { type: "boolean" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        requireMention: { type: "boolean" },
        allowFrom: { type: "array", items: { type: "string" } },
        groupAllowFrom: { type: "array", items: { type: "string" } },
        historyLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        replyFinalOnly: { type: "boolean" },
      },
    },
  },

  reload: { configPrefixes: ["channels.qqbot"] },

  config: {
    listAccountIds: (_cfg: PluginConfig): string[] => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg: PluginConfig, accountId?: string): ResolvedQQBotAccount =>
      resolveQQBotAccount({ cfg, accountId }),
    defaultAccountId: (): string => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: (params: { cfg: PluginConfig; enabled: boolean }): PluginConfig => {
      const existing = params.cfg.channels?.qqbot ?? {};
      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          qqbot: {
            ...existing,
            enabled: params.enabled,
          } as QQBotConfig,
        },
      };
    },
    deleteAccount: (params: { cfg: PluginConfig }): PluginConfig => {
      const next = { ...params.cfg };
      const nextChannels = { ...params.cfg.channels };
      delete (nextChannels as Record<string, unknown>).qqbot;
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (_account: ResolvedQQBotAccount, cfg: PluginConfig): boolean =>
      isConfigured(cfg.channels?.qqbot),
    describeAccount: (account: ResolvedQQBotAccount) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: (params: { cfg: PluginConfig }): string[] =>
      params.cfg.channels?.qqbot?.allowFrom ?? [],
    formatAllowFrom: (params: { allowFrom: (string | number)[] }): string[] =>
      params.allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  security: {
    collectWarnings: (params: { cfg: PluginConfig }): string[] => {
      const qqCfg = params.cfg.channels?.qqbot;
      const groupPolicy = qqCfg?.groupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- QQ groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.qqbot.groupPolicy="allowlist" + channels.qqbot.groupAllowFrom to restrict senders.`,
      ];
    },
  },

  setup: {
    resolveAccountId: (): string => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: (params: { cfg: PluginConfig }): PluginConfig => {
      const existing = params.cfg.channels?.qqbot ?? {};
      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          qqbot: {
            ...existing,
            enabled: true,
          } as QQBotConfig,
        },
      };
    },
  },

  outbound: qqbotOutbound,

  gateway: {
    startAccount: async (ctx: {
      cfg: PluginConfig;
      runtime?: unknown;
      abortSignal?: AbortSignal;
      accountId: string;
      setStatus?: (status: Record<string, unknown>) => void;
      log?: { info: (msg: string) => void; error: (msg: string) => void };
    }): Promise<void> => {
      ctx.setStatus?.({ accountId: ctx.accountId });
      ctx.log?.info(`[qqbot] starting gateway for account ${ctx.accountId}`);

      if (ctx.runtime) {
        const candidate = ctx.runtime as {
          channel?: {
            routing?: { resolveAgentRoute?: unknown };
            reply?: { dispatchReplyFromConfig?: unknown };
          };
        };
        if (
          candidate.channel?.routing?.resolveAgentRoute &&
          candidate.channel?.reply?.dispatchReplyFromConfig
        ) {
          setQQBotRuntime(ctx.runtime as Record<string, unknown>);
        }
      }

      await monitorQQBotProvider({
        config: ctx.cfg,
        runtime:
          (ctx.runtime as { log?: (msg: string) => void; error?: (msg: string) => void }) ?? {
            log: ctx.log?.info ?? console.log,
            error: ctx.log?.error ?? console.error,
          },
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
    stopAccount: async (_ctx: { accountId: string }): Promise<void> => {
      stopQQBotMonitor();
    },
    getStatus: () => ({ connected: true }),
  },
};
