import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { ChannelSetupInput } from "openclaw/plugin-sdk/setup";
import type {
  DingtalkAccountConfig,
  DingtalkConfig,
  ResolvedDingtalkAccount,
} from "./types.js";
import {
  DEFAULT_ACCOUNT_ID,
  listDingtalkAccountIds,
  mergeDingtalkAccountConfig,
  moveDingtalkSingleAccountConfigToDefaultAccount,
  resolveDefaultDingtalkAccountId,
  resolveDingtalkAccountId,
  resolveDingtalkCredentials,
  type PluginConfig,
} from "./config.js";
import { dingtalkSetupWizard } from "./onboarding.js";
import {
  formatDingtalkTargetDisplay,
  inferDingtalkTargetChatType,
  looksLikeDingtalkTarget,
  normalizeDingtalkMessagingTarget,
} from "./targets.js";

const meta = {
  id: "dingtalk",
  label: "DingTalk",
  selectionLabel: "DingTalk (钉钉)",
  docsPath: "/channels/dingtalk",
  docsLabel: "dingtalk",
  blurb: "钉钉企业消息",
  aliases: ["ding"] as string[],
  order: 71,
};

const dingtalkChannelConfigSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      name: { type: "string" },
      defaultAccount: { type: "string" },
      clientId: { type: "string" },
      clientSecret: { type: "string" },
      connectionMode: { type: "string", enum: ["stream", "webhook"] },
      dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
      groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
      requireMention: { type: "boolean" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupAllowFrom: { type: "array", items: { type: "string" } },
      historyLimit: { type: "integer", minimum: 0 },
      textChunkLimit: { type: "integer", minimum: 1 },
      longTaskNoticeDelayMs: { type: "integer", minimum: 0 },
      enableAICard: { type: "boolean" },
      gatewayToken: { type: "string" },
      gatewayPassword: { type: "string" },
      maxFileSizeMB: { type: "number", minimum: 0 },
      inboundMedia: {
        type: "object",
        additionalProperties: false,
        properties: {
          dir: { type: "string" },
          keepDays: { type: "number", minimum: 0 },
        },
      },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            enabled: { type: "boolean" },
            clientId: { type: "string" },
            clientSecret: { type: "string" },
            connectionMode: { type: "string", enum: ["stream", "webhook"] },
            dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
            groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
            requireMention: { type: "boolean" },
            allowFrom: { type: "array", items: { type: "string" } },
            groupAllowFrom: { type: "array", items: { type: "string" } },
            historyLimit: { type: "integer", minimum: 0 },
            textChunkLimit: { type: "integer", minimum: 1 },
            longTaskNoticeDelayMs: { type: "integer", minimum: 0 },
            enableAICard: { type: "boolean" },
            gatewayToken: { type: "string" },
            gatewayPassword: { type: "string" },
            maxFileSizeMB: { type: "number", minimum: 0 },
            inboundMedia: {
              type: "object",
              additionalProperties: false,
              properties: {
                dir: { type: "string" },
                keepDays: { type: "number", minimum: 0 },
              },
            },
          },
        },
      },
    },
  },
} as const;

type DingtalkSetupPayload = ChannelSetupInput & Partial<DingtalkAccountConfig>;

function canStoreDefaultAccountInAccounts(cfg: PluginConfig): boolean {
  return Boolean(cfg.channels?.dingtalk?.accounts?.[DEFAULT_ACCOUNT_ID]);
}

export function applyDingtalkAccountPatch(
  cfg: PluginConfig,
  accountId: string,
  patch: Partial<DingtalkAccountConfig>,
): PluginConfig {
  const seededCfg = moveDingtalkSingleAccountConfigToDefaultAccount(cfg);
  const existing = seededCfg.channels?.dingtalk ?? {};

  if (accountId === DEFAULT_ACCOUNT_ID && !canStoreDefaultAccountInAccounts(seededCfg)) {
    return {
      ...seededCfg,
      channels: {
        ...seededCfg.channels,
        dingtalk: {
          ...existing,
          ...patch,
          enabled: true,
        } as DingtalkConfig,
      },
    };
  }

  const accounts = (existing as DingtalkConfig).accounts ?? {};
  return {
    ...seededCfg,
    channels: {
      ...seededCfg.channels,
      dingtalk: {
        ...existing,
        enabled: true,
        accounts: {
          ...accounts,
          [accountId]: {
            ...accounts[accountId],
            ...patch,
            enabled: true,
          },
        },
      } as DingtalkConfig,
    },
  };
}

function buildSetupPatch(
  input?: ChannelSetupInput | Record<string, unknown>,
): Partial<DingtalkAccountConfig> {
  const raw = (input ?? {}) as DingtalkSetupPayload;
  const patch: Partial<DingtalkAccountConfig> = {};
  if (typeof raw.name === "string" && raw.name.trim()) {
    patch.name = raw.name.trim();
  }
  if (typeof raw.clientId === "string" && raw.clientId.trim()) {
    patch.clientId = raw.clientId.trim();
  }
  if (typeof raw.clientSecret === "string" && raw.clientSecret.trim()) {
    patch.clientSecret = raw.clientSecret.trim();
  }
  if (
    (raw.connectionMode === "stream" || raw.connectionMode === "webhook") &&
    raw.connectionMode
  ) {
    patch.connectionMode = raw.connectionMode;
  }
  if (
    raw.dmPolicy === "open" ||
    raw.dmPolicy === "pairing" ||
    raw.dmPolicy === "allowlist"
  ) {
    patch.dmPolicy = raw.dmPolicy;
  }
  if (
    raw.groupPolicy === "open" ||
    raw.groupPolicy === "allowlist" ||
    raw.groupPolicy === "disabled"
  ) {
    patch.groupPolicy = raw.groupPolicy;
  }
  if (typeof raw.gatewayToken === "string" && raw.gatewayToken.trim()) {
    patch.gatewayToken = raw.gatewayToken.trim();
  }
  if (typeof raw.gatewayPassword === "string" && raw.gatewayPassword.trim()) {
    patch.gatewayPassword = raw.gatewayPassword.trim();
  }

  if (typeof raw.enabled === "boolean") {
    patch.enabled = raw.enabled;
  }
  if (typeof raw.requireMention === "boolean") {
    patch.requireMention = raw.requireMention;
  }
  if (typeof raw.enableAICard === "boolean") {
    patch.enableAICard = raw.enableAICard;
  }
  if (Array.isArray(raw.allowFrom)) {
    patch.allowFrom = raw.allowFrom.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (Array.isArray(raw.groupAllowFrom)) {
    patch.groupAllowFrom = raw.groupAllowFrom.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof raw.historyLimit === "number" && Number.isFinite(raw.historyLimit)) {
    patch.historyLimit = raw.historyLimit;
  }
  if (typeof raw.textChunkLimit === "number" && Number.isFinite(raw.textChunkLimit)) {
    patch.textChunkLimit = raw.textChunkLimit;
  }
  if (
    typeof raw.longTaskNoticeDelayMs === "number" &&
    Number.isFinite(raw.longTaskNoticeDelayMs)
  ) {
    patch.longTaskNoticeDelayMs = raw.longTaskNoticeDelayMs;
  }
  if (typeof raw.maxFileSizeMB === "number" && Number.isFinite(raw.maxFileSizeMB)) {
    patch.maxFileSizeMB = raw.maxFileSizeMB;
  }
  if (raw.inboundMedia && typeof raw.inboundMedia === "object") {
    patch.inboundMedia = raw.inboundMedia;
  }

  return patch;
}

function resolveDingtalkAccount(params: {
  cfg: PluginConfig;
  accountId?: string | null;
}): ResolvedDingtalkAccount {
  const accountId = resolveDingtalkAccountId(params.cfg, params.accountId);
  const merged = mergeDingtalkAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.dingtalk?.enabled !== false;
  const enabled = baseEnabled && merged.enabled !== false;
  const credentials = resolveDingtalkCredentials(merged);

  return {
    accountId,
    name: merged.name,
    enabled,
    configured: Boolean(credentials),
    clientId: credentials?.clientId,
    config: merged,
  };
}

function collectDingtalkSecurityWarnings(account: ResolvedDingtalkAccount): string[] {
  if (account.config.groupPolicy !== "open") {
    return [];
  }
  return [
    '- DingTalk groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.dingtalk.groupPolicy="allowlist" + channels.dingtalk.groupAllowFrom to restrict senders.',
  ];
}

export const dingtalkSecurityOptions = {
  dm: {
    channelKey: "dingtalk",
    resolvePolicy: (account: ResolvedDingtalkAccount) => account.config.dmPolicy,
    resolveAllowFrom: (account: ResolvedDingtalkAccount) => account.config.allowFrom,
    defaultPolicy: "open",
    normalizeEntry: (entry: string) => entry.trim().toLowerCase(),
  },
  collectWarnings: ({ account }: { account: ResolvedDingtalkAccount }) =>
    collectDingtalkSecurityWarnings(account),
};

export const dingtalkPluginBase = {
  id: "dingtalk",
  meta,
  setupWizard: dingtalkSetupWizard,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    edit: false,
    reply: true,
    polls: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.dingtalk"] },
  configSchema: dingtalkChannelConfigSchema,
  config: {
    listAccountIds: (cfg: OpenClawConfig): string[] => listDingtalkAccountIds(cfg as PluginConfig),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null): ResolvedDingtalkAccount =>
      resolveDingtalkAccount({ cfg: cfg as PluginConfig, accountId }),
    inspectAccount: (cfg: OpenClawConfig, accountId?: string | null) => {
      const account = resolveDingtalkAccount({ cfg: cfg as PluginConfig, accountId });
      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
      };
    },
    defaultAccountId: (cfg: OpenClawConfig): string =>
      resolveDefaultDingtalkAccountId(cfg as PluginConfig),
    setAccountEnabled: (params: {
      cfg: OpenClawConfig;
      accountId: string;
      enabled: boolean;
    }): OpenClawConfig => {
      const next = applyDingtalkAccountPatch(params.cfg as PluginConfig, params.accountId, {
        enabled: params.enabled,
      });
      return next as OpenClawConfig;
    },
    deleteAccount: (params: { cfg: OpenClawConfig; accountId: string }): OpenClawConfig => {
      const accountId = resolveDingtalkAccountId(params.cfg as PluginConfig, params.accountId);
      const seededCfg = moveDingtalkSingleAccountConfigToDefaultAccount(
        params.cfg as PluginConfig,
      );
      const existing = seededCfg.channels?.dingtalk;
      if (!existing) {
        return params.cfg;
      }

      const accounts = existing.accounts ?? {};
      if (!accounts[accountId]) {
        if (
          accountId === DEFAULT_ACCOUNT_ID &&
          Object.keys(accounts).length === 0 &&
          !canStoreDefaultAccountInAccounts(seededCfg)
        ) {
          const next = { ...seededCfg };
          const nextChannels = { ...seededCfg.channels };
          delete (nextChannels as Record<string, unknown>).dingtalk;
          if (Object.keys(nextChannels).length > 0) {
            next.channels = nextChannels;
          } else {
            delete next.channels;
          }
          return next as OpenClawConfig;
        }
        return params.cfg;
      }

      const { [accountId]: _removed, ...remainingAccounts } = accounts;
      const remainingIds = Object.keys(remainingAccounts).sort((a, b) => a.localeCompare(b));
      const preferred = existing.defaultAccount?.trim();
      let nextDefaultAccount = preferred;
      if (preferred && !remainingAccounts[preferred]) {
        nextDefaultAccount =
          remainingIds.includes(DEFAULT_ACCOUNT_ID) ? DEFAULT_ACCOUNT_ID : (remainingIds[0] ?? "");
      }

      const nextChannel = {
        ...existing,
        accounts: remainingIds.length > 0 ? remainingAccounts : undefined,
        defaultAccount: nextDefaultAccount || undefined,
      } as DingtalkConfig;
      const hasNonTrivialRootConfig = Object.entries(nextChannel).some(
        ([key, value]) =>
          key !== "enabled" &&
          key !== "accounts" &&
          key !== "defaultAccount" &&
          value !== undefined,
      );

      if (remainingIds.length === 0 && !hasNonTrivialRootConfig) {
        const next = { ...seededCfg };
        const nextChannels = { ...seededCfg.channels };
        delete (nextChannels as Record<string, unknown>).dingtalk;
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next as OpenClawConfig;
      }

      return {
        ...seededCfg,
        channels: {
          ...seededCfg.channels,
          dingtalk: nextChannel,
        },
      } as OpenClawConfig;
    },
    isEnabled: (account: ResolvedDingtalkAccount) => account.enabled,
    isConfigured: (account: ResolvedDingtalkAccount) => account.configured,
    describeAccount: (account: ResolvedDingtalkAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) => {
      const resolved = resolveDingtalkAccount({ cfg: cfg as PluginConfig, accountId });
      return resolved.config.allowFrom ?? [];
    },
    formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  setup: {
    resolveAccountId: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string }) =>
      resolveDingtalkAccountId(cfg as PluginConfig, accountId),
    applyAccountConfig: ({
      cfg,
      accountId,
      input,
      ...legacy
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      input?: ChannelSetupInput;
      config?: Record<string, unknown>;
    }): OpenClawConfig => {
      const resolvedAccountId = resolveDingtalkAccountId(cfg as PluginConfig, accountId);
      const patch = buildSetupPatch(input ?? legacy.config);
      return applyDingtalkAccountPatch(
        cfg as PluginConfig,
        resolvedAccountId,
        patch,
      ) as OpenClawConfig;
    },
  },
  groups: {
    resolveRequireMention: ({
      cfg,
      accountId,
    }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
    }) => {
      const resolved = resolveDingtalkAccount({
        cfg: cfg as PluginConfig,
        accountId: accountId ?? undefined,
      });
      return resolved.config.requireMention ?? true;
    },
  },
  messaging: {
    normalizeTarget: (raw: string): string | undefined => normalizeDingtalkMessagingTarget(raw),
    inferTargetChatType: ({ to }: { to: string }) => inferDingtalkTargetChatType(to),
    targetResolver: {
      looksLikeId: (raw: string, normalized?: string) =>
        looksLikeDingtalkTarget(raw, normalized),
      hint: "Use user:<userid> for DMs or group:<conversationId> for DingTalk groups. Legacy chat:<id> is also accepted.",
    },
    formatTargetDisplay: (params: { target: string; display?: string }) =>
      formatDingtalkTargetDisplay(params),
  },
} satisfies Pick<
  ChannelPlugin<ResolvedDingtalkAccount>,
  | "id"
  | "meta"
  | "setupWizard"
  | "capabilities"
  | "reload"
  | "configSchema"
  | "config"
  | "setup"
  | "groups"
  | "messaging"
>;
