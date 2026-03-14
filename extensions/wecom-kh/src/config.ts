/**
 * 企业微信客户渠道配置 schema
 */
import { z } from "zod";

import type {
  ResolvedWecomKhAccount,
  WecomKhAccountConfig,
  WecomKhConfig,
  WecomKhDmPolicy,
} from "./types.js";

/** 默认账户 ID */
export const DEFAULT_ACCOUNT_ID = "default";

const WecomKhAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  webhookPath: z.string().optional(),
  token: z.string().optional(),
  encodingAESKey: z.string().optional(),
  receiveId: z.string().optional(),
  corpId: z.string().optional(),
  khSecret: z.string().optional(),
  openKfId: z.string().optional(),
  agentId: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  welcomeText: z.string().optional(),
  dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).optional(),
  allowFrom: z.array(z.string()).optional(),
});

export const WecomKhConfigSchema = WecomKhAccountSchema.extend({
  defaultAccount: z.string().optional(),
  accounts: z.record(WecomKhAccountSchema).optional(),
});

export type ParsedWecomKhConfig = z.infer<typeof WecomKhConfigSchema>;

export const WecomKhConfigJsonSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      enabled: { type: "boolean" },
      webhookPath: { type: "string" },
      token: { type: "string" },
      encodingAESKey: { type: "string" },
      receiveId: { type: "string" },
      corpId: { type: "string" },
      khSecret: { type: "string" },
      openKfId: { type: "string" },
      agentId: { type: "string" },
      apiBaseUrl: { type: "string" },
      welcomeText: { type: "string" },
      dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist", "disabled"] },
      allowFrom: { type: "array", items: { type: "string" } },
      defaultAccount: { type: "string" },
      accounts: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            enabled: { type: "boolean" },
            webhookPath: { type: "string" },
            token: { type: "string" },
            encodingAESKey: { type: "string" },
            receiveId: { type: "string" },
            corpId: { type: "string" },
            khSecret: { type: "string" },
            openKfId: { type: "string" },
            agentId: { type: "string" },
            apiBaseUrl: { type: "string" },
            welcomeText: { type: "string" },
            dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist", "disabled"] },
            allowFrom: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  },
};

export interface PluginConfig {
  session?: {
    store?: unknown;
  };
  channels?: {
    "wecom-kh"?: WecomKhConfig;
  };
}

export function normalizeAccountId(raw?: string | null): string {
  const trimmed = String(raw ?? "").trim();
  return trimmed || DEFAULT_ACCOUNT_ID;
}

function listConfiguredAccountIds(cfg: PluginConfig): string[] {
  const accounts = cfg.channels?.["wecom-kh"]?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listWecomKhAccountIds(cfg: PluginConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultWecomKhAccountId(cfg: PluginConfig): string {
  const khConfig = cfg.channels?.["wecom-kh"];
  if (khConfig?.defaultAccount?.trim()) return khConfig.defaultAccount.trim();
  const ids = listWecomKhAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(cfg: PluginConfig, accountId: string): WecomKhAccountConfig | undefined {
  const accounts = cfg.channels?.["wecom-kh"]?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as WecomKhAccountConfig | undefined;
}

function mergeWecomKhAccountConfig(cfg: PluginConfig, accountId: string): WecomKhAccountConfig {
  const base = (cfg.channels?.["wecom-kh"] ?? {}) as WecomKhConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...baseConfig } = base;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...baseConfig, ...account };
}

export function resolveWecomKhAccount(params: { cfg: PluginConfig; accountId?: string | null }): ResolvedWecomKhAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.["wecom-kh"]?.enabled !== false;
  const merged = mergeWecomKhAccountConfig(params.cfg, accountId);
  const enabled = baseEnabled && merged.enabled !== false;

  const isDefaultAccount = accountId === DEFAULT_ACCOUNT_ID;

  // 回调配置
  const token = merged.token?.trim() || (isDefaultAccount ? process.env.WECOM_KH_TOKEN?.trim() : undefined) || undefined;
  const encodingAESKey =
    merged.encodingAESKey?.trim() ||
    (isDefaultAccount ? process.env.WECOM_KH_ENCODING_AES_KEY?.trim() : undefined) ||
    undefined;
  const receiveId = merged.receiveId?.trim() ?? "";

  // 客户配置
  const corpId = merged.corpId?.trim() || (isDefaultAccount ? process.env.WECOM_KH_CORP_ID?.trim() : undefined) || undefined;
  const khSecret =
    merged.khSecret?.trim() || (isDefaultAccount ? process.env.WECOM_KH_SECRET?.trim() : undefined) || undefined;
  const openKfId =
    merged.openKfId?.trim() ||
    merged.agentId?.trim() ||
    (isDefaultAccount ? process.env.WECOM_KH_OPEN_KFID?.trim() : undefined) ||
    undefined;
  const apiBaseUrl =
    merged.apiBaseUrl?.trim() ||
    (isDefaultAccount ? process.env.WECOM_KH_API_BASE_URL?.trim() : undefined) ||
    undefined;

  const configured = Boolean(token && encodingAESKey);
  const canSend = Boolean(corpId && khSecret && openKfId);

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    configured,
    token,
    encodingAESKey,
    receiveId,
    corpId,
    khSecret,
    openKfId,
    agentId: openKfId,
    canSend,
    config: { ...merged, openKfId, agentId: openKfId, apiBaseUrl },
  };
}

export function listEnabledWecomKhAccounts(cfg: PluginConfig): ResolvedWecomKhAccount[] {
  return listWecomKhAccountIds(cfg)
    .map((accountId) => resolveWecomKhAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

export function resolveDmPolicy(config: WecomKhAccountConfig): WecomKhDmPolicy {
  return (config.dmPolicy ?? "open") as WecomKhDmPolicy;
}

export function resolveAllowFrom(config: WecomKhAccountConfig): string[] {
  return config.allowFrom ?? [];
}

export const DEFAULT_WECOM_KH_API_BASE_URL = "https://qyapi.weixin.qq.com";

export function resolveApiBaseUrl(config: WecomKhAccountConfig): string {
  const raw = (config.apiBaseUrl ?? "").trim();
  if (!raw) return DEFAULT_WECOM_KH_API_BASE_URL;
  return raw.replace(/\/+$/, "");
}
