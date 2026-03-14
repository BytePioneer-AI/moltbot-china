/**
 * 企业微信客户渠道 ChannelPlugin 实现
 *
 * 面向外部微信用户的客户聊天场景
 */

import type { ResolvedWecomKhAccount, WecomKhConfig } from "./types.js";
import {
  DEFAULT_ACCOUNT_ID,
  listWecomKhAccountIds,
  resolveDefaultWecomKhAccountId,
  resolveWecomKhAccount,
  resolveAllowFrom,
  WecomKhConfigJsonSchema,
  type PluginConfig,
} from "./config.js";
import { registerWecomKhWebhookTarget } from "./monitor.js";
import { setWecomKhRuntime } from "./runtime.js";
import { sendKhMessage, downloadAndSendImage } from "./api.js";

type ParsedDirectTarget = {
  accountId?: string;
  externalUserId: string;
};

const EXTERNAL_USERID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

/**
 * 统一解析 wecom-kh 直发目标
 * 支持：
 * - wecom-kh:user:<externalUserId>
 * - user:<externalUserId>
 * - <externalUserId>
 * - 上述格式 + @accountId 后缀
 */
function parseDirectTarget(rawTarget: string): ParsedDirectTarget | null {
  let raw = String(rawTarget ?? "").trim();
  if (!raw) return null;

  if (raw.startsWith("wecom-kh:")) {
    raw = raw.slice("wecom-kh:".length);
  }

  let accountId: string | undefined;
  const atIdx = raw.lastIndexOf("@");
  if (atIdx > 0 && atIdx < raw.length - 1) {
    const candidate = raw.slice(atIdx + 1);
    if (!/[:/]/.test(candidate)) {
      accountId = candidate;
      raw = raw.slice(0, atIdx);
    }
  }

  if (raw.startsWith("group:")) return null;
  const explicitUserPrefix = raw.startsWith("user:");
  if (explicitUserPrefix) raw = raw.slice(5);

  const externalUserId = raw.trim();
  if (!externalUserId) return null;
  if (/\s/.test(externalUserId)) return null;
  if (!EXTERNAL_USERID_RE.test(externalUserId)) return null;

  return { accountId, externalUserId };
}

const meta = {
  id: "wecom-kh",
  label: "WeCom KH",
  selectionLabel: "WeCom Customer (企微客户)",
  docsPath: "/channels/wecom-kh",
  docsLabel: "wecom-kh",
  blurb: "企业微信客户渠道，支持外部微信用户聊天",
  aliases: ["qywx-kh", "企微客户", "微信客户"],
  order: 85,
} as const;

const unregisterHooks = new Map<string, () => void>();

export const wecomKhPlugin = {
  id: "wecom-kh",

  meta: {
    ...meta,
  },

  capabilities: {
    chatTypes: ["direct"] as const,
    media: false,
    reactions: false,
    threads: false,
    edit: false,
    reply: false,
    polls: false,
    /** 支持主动发送（48小时窗口内） */
    activeSend: true,
  },

  messaging: {
    normalizeTarget: (raw: string): string | undefined => {
      const parsed = parseDirectTarget(raw);
      if (!parsed) return undefined;
      return `user:${parsed.externalUserId}${parsed.accountId ? `@${parsed.accountId}` : ""}`;
    },
    targetResolver: {
      looksLikeId: (raw: string, normalized?: string) => {
        const candidate = (normalized ?? raw).trim();
        return Boolean(parseDirectTarget(candidate));
      },
      hint: "Use external_userid only: user:<external_userid> (optional @accountId). Do not use display names.",
    },
    formatTargetDisplay: (params: { target: string; display?: string }) => {
      const parsed = parseDirectTarget(params.target);
      if (!parsed) return params.display?.trim() || params.target;
      return `user:${parsed.externalUserId}`;
    },
  },

  configSchema: WecomKhConfigJsonSchema,

  reload: { configPrefixes: ["channels.wecom-kh"] },

  config: {
    listAccountIds: (cfg: PluginConfig): string[] => listWecomKhAccountIds(cfg),

    resolveAccount: (cfg: PluginConfig, accountId?: string): ResolvedWecomKhAccount =>
      resolveWecomKhAccount({ cfg, accountId }),

    defaultAccountId: (cfg: PluginConfig): string => resolveDefaultWecomKhAccountId(cfg),

    setAccountEnabled: (params: { cfg: PluginConfig; accountId?: string; enabled: boolean }): PluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccount = Boolean(params.cfg.channels?.["wecom-kh"]?.accounts?.[accountId]);
      if (!useAccount) {
        return {
          ...params.cfg,
          channels: {
            ...params.cfg.channels,
            "wecom-kh": {
              ...(params.cfg.channels?.["wecom-kh"] ?? {}),
              enabled: params.enabled,
            } as WecomKhConfig,
          },
        };
      }

      return {
        ...params.cfg,
        channels: {
          ...params.cfg.channels,
          "wecom-kh": {
            ...(params.cfg.channels?.["wecom-kh"] ?? {}),
            accounts: {
              ...(params.cfg.channels?.["wecom-kh"]?.accounts ?? {}),
              [accountId]: {
                ...(params.cfg.channels?.["wecom-kh"]?.accounts?.[accountId] ?? {}),
                enabled: params.enabled,
              },
            },
          } as WecomKhConfig,
        },
      };
    },

    deleteAccount: (params: { cfg: PluginConfig; accountId?: string }): PluginConfig => {
      const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
      const next = { ...params.cfg };
      const current = next.channels?.["wecom-kh"];
      if (!current) return next;

      if (accountId === DEFAULT_ACCOUNT_ID) {
        const { accounts: _ignored, defaultAccount: _ignored2, ...rest } = current as WecomKhConfig;
        next.channels = {
          ...next.channels,
          "wecom-kh": { ...(rest as WecomKhConfig), enabled: false },
        };
        return next;
      }

      const accounts = { ...(current.accounts ?? {}) };
      delete accounts[accountId];

      next.channels = {
        ...next.channels,
        "wecom-kh": {
          ...(current as WecomKhConfig),
          accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
        },
      };

      return next;
    },

    isConfigured: (account: ResolvedWecomKhAccount): boolean => account.configured,

    describeAccount: (account: ResolvedWecomKhAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      canSend: account.canSend,
      openKfId: account.openKfId,
      agentId: account.agentId,
      webhookPath: account.config.webhookPath ?? "/wecom-kh",
    }),

    resolveAllowFrom: (params: { cfg: PluginConfig; accountId?: string }): string[] => {
      const account = resolveWecomKhAccount({ cfg: params.cfg, accountId: params.accountId });
      return resolveAllowFrom(account.config);
    },

    formatAllowFrom: (params: { allowFrom: (string | number)[] }): string[] =>
      params.allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean),
  },

  directory: {
    canResolve: (params: { target: string }): boolean => {
      return Boolean(parseDirectTarget(params.target));
    },

    resolveTarget: (params: {
      cfg: PluginConfig;
      target: string;
    }): {
      channel: string;
      accountId?: string;
      to: string;
    } | null => {
      const parsed = parseDirectTarget(params.target);
      if (!parsed) return null;
      return { channel: "wecom-kh", accountId: parsed.accountId, to: parsed.externalUserId };
    },

    resolveTargets: (params: {
      cfg: PluginConfig;
      targets: string[];
    }): Array<{
      channel: string;
      accountId?: string;
      to: string;
    }> => {
      const results: Array<{
        channel: string;
        accountId?: string;
        to: string;
      }> = [];

      for (const target of params.targets) {
        const resolved = wecomKhPlugin.directory.resolveTarget({
          cfg: params.cfg,
          target,
        });
        if (resolved) {
          results.push(resolved);
        }
      }

      return results;
    },

    getTargetFormats: (): string[] => [
      "wecom-kh:user:<externalUserId>",
      "user:<externalUserId>",
      "<externalUserId>",
    ],
  },

  outbound: {
    deliveryMode: "direct",

    sendText: async (params: {
      cfg: PluginConfig;
      accountId?: string;
      to: string;
      text: string;
      options?: { markdown?: boolean };
    }): Promise<{
      channel: string;
      ok: boolean;
      messageId: string;
      error?: Error;
    }> => {
      const parsed = parseDirectTarget(params.to);
      if (!parsed) {
        return {
          channel: "wecom-kh",
          ok: false,
          messageId: "",
          error: new Error(`Unsupported target for WeCom KH: ${params.to}`),
        };
      }

      const accountId = parsed.accountId ?? params.accountId;
      const account = resolveWecomKhAccount({ cfg: params.cfg, accountId });

      if (!account.canSend) {
        return {
          channel: "wecom-kh",
          ok: false,
          messageId: "",
          error: new Error("Account not configured for sending (missing corpId, khSecret, or openKfId)"),
        };
      }

      try {
        const result = await sendKhMessage(account, { externalUserId: parsed.externalUserId }, params.text);
        return {
          channel: "wecom-kh",
          ok: result.ok,
          messageId: result.msgid ?? "",
          error: result.ok ? undefined : new Error(result.errmsg ?? "send failed"),
        };
      } catch (err) {
        return {
          channel: "wecom-kh",
          ok: false,
          messageId: "",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },

    sendMedia: async (params: {
      cfg: PluginConfig;
      accountId?: string;
      to: string;
      mediaUrl: string;
      text?: string;
      mimeType?: string;
    }): Promise<{
      channel: string;
      ok: boolean;
      messageId: string;
      error?: Error;
    }> => {
      const parsed = parseDirectTarget(params.to);
      if (!parsed) {
        return {
          channel: "wecom-kh",
          ok: false,
          messageId: "",
          error: new Error(`Unsupported target for WeCom KH: ${params.to}`),
        };
      }

      const accountId = parsed.accountId ?? params.accountId;
      const account = resolveWecomKhAccount({ cfg: params.cfg, accountId });

      if (!account.canSend) {
        return {
          channel: "wecom-kh",
          ok: false,
          messageId: "",
          error: new Error("Account not configured for sending"),
        };
      }

      try {
        const result = await downloadAndSendImage(account, { externalUserId: parsed.externalUserId }, params.mediaUrl);
        return {
          channel: "wecom-kh",
          ok: result.ok,
          messageId: result.msgid ?? "",
          error: result.ok ? undefined : new Error(result.errmsg ?? "send failed"),
        };
      } catch (err) {
        return {
          channel: "wecom-kh",
          ok: false,
          messageId: "",
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
  },

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

      if (ctx.runtime) {
        const candidate = ctx.runtime as {
          channel?: {
            routing?: { resolveAgentRoute?: unknown };
            reply?: { dispatchReplyFromConfig?: unknown };
          };
        };
        if (candidate.channel?.routing?.resolveAgentRoute && candidate.channel?.reply?.dispatchReplyFromConfig) {
          setWecomKhRuntime(ctx.runtime as Record<string, unknown>);
        }
      }

      const account = resolveWecomKhAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
      if (!account.configured) {
        ctx.log?.info(`[wecom-kh] account ${ctx.accountId} not configured; webhook not registered`);
        ctx.setStatus?.({ accountId: ctx.accountId, running: false, configured: false });
        return;
      }

      const path = (account.config.webhookPath ?? "/wecom-kh").trim();
      const unregister = registerWecomKhWebhookTarget({
        account,
        config: (ctx.cfg ?? {}) as PluginConfig,
        runtime: {
          log: ctx.log?.info ?? console.log,
          error: ctx.log?.error ?? console.error,
        },
        path,
        statusSink: (patch) => ctx.setStatus?.({ accountId: ctx.accountId, ...patch }),
      });

      const existing = unregisterHooks.get(ctx.accountId);
      if (existing) existing();
      unregisterHooks.set(ctx.accountId, unregister);

      ctx.log?.info(`[wecom-kh] webhook registered at ${path} for account ${ctx.accountId} (canSend=${account.canSend})`);
      ctx.setStatus?.({
        accountId: ctx.accountId,
        running: true,
        configured: true,
        canSend: account.canSend,
        openKfId: account.openKfId,
        agentId: account.agentId,
        webhookPath: path,
        lastStartAt: Date.now(),
      });

      try {
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          if (!ctx.abortSignal) {
            return;
          }
          ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        const current = unregisterHooks.get(ctx.accountId);
        if (current === unregister) {
          unregisterHooks.delete(ctx.accountId);
        }
        unregister();
        ctx.setStatus?.({ accountId: ctx.accountId, running: false, lastStopAt: Date.now() });
      }
    },

    stopAccount: async (ctx: { accountId: string; setStatus?: (status: Record<string, unknown>) => void }): Promise<void> => {
      const unregister = unregisterHooks.get(ctx.accountId);
      if (unregister) {
        unregister();
        unregisterHooks.delete(ctx.accountId);
      }
      ctx.setStatus?.({ accountId: ctx.accountId, running: false, lastStopAt: Date.now() });
    },
  },
};

export { DEFAULT_ACCOUNT_ID } from "./config.js";
