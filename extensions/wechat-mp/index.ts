import type { IncomingMessage, ServerResponse } from "http";

import { registerChinaSetupCli, showChinaInstallHint } from "@openclaw-china/shared";

import { wechatMpPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
import { setWechatMpRuntime, getWechatMpRuntime } from "./src/runtime.js";
import { sendWechatMpActiveText } from "./src/send.js";
import { handleWechatMpWebhookRequest } from "./src/webhook.js";

export { wechatMpPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
export type { ResolvedWechatMpAccount } from "./src/channel.js";
export { setWechatMpRuntime, getWechatMpRuntime } from "./src/runtime.js";
export { sendWechatMpActiveText } from "./src/send.js";

type HttpRouteMatch = "exact" | "prefix";
type HttpRouteAuth = "gateway" | "plugin";

type HttpRouteParams = {
  path: string;
  auth: HttpRouteAuth;
  match?: HttpRouteMatch;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
};

export interface MoltbotPluginApi {
  registerChannel: (opts: { plugin: unknown }) => void;
  registerCli?: (
    registrar: (ctx: { program: unknown; config?: PluginConfig }) => void | Promise<void>,
    opts?: { commands?: string[] }
  ) => void;
  registerHttpHandler?: (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean
  ) => void;
  registerHttpRoute?: (params: HttpRouteParams) => void;
  config?: PluginConfig;
  runtime?: unknown;
  [key: string]: unknown;
}

export interface PluginConfig {
  session?: {
    store?: unknown;
  };
  channels?: Record<string, unknown> & {
    "wechat-mp"?: WechatMpConfig;
  };
  [key: string]: unknown;
}

export interface WechatMpConfig {
  enabled?: boolean;
  name?: string;
  appId?: string;
  appSecret?: string;
  encodingAESKey?: string;
  token?: string;
  webhookPath?: string;
  messageMode?: WechatMpMessageMode;
  replyMode?: WechatMpReplyMode;
  welcomeText?: string;
  dmPolicy?: WechatMpDmPolicy;
  allowFrom?: string[];
  defaultAccount?: string;
  accounts?: Record<string, WechatMpAccountConfig>;
}

export interface WechatMpAccountConfig {
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encodingAESKey?: string;
  token?: string;
  webhookPath?: string;
  messageMode?: WechatMpMessageMode;
  replyMode?: WechatMpReplyMode;
  welcomeText?: string;
  dmPolicy?: WechatMpDmPolicy;
  allowFrom?: string[];
}

export type WechatMpMessageMode = "plain" | "safe" | "compat";
export type WechatMpReplyMode = "passive" | "active";
export type WechatMpDmPolicy = "open" | "pairing" | "allowlist" | "disabled";

/**
 * Collect webhook paths for all configured accounts.
 * Used to register HTTP routes with the host.
 */
export function collectWechatMpRoutePaths(config: PluginConfig): string[] {
  const paths: string[] = [];
  const cfg = config?.channels?.["wechat-mp"] as WechatMpConfig | undefined;

  if (!cfg) return paths;

  const defaultPath = cfg.webhookPath ?? "/wechat-mp";
  paths.push(defaultPath);

  if (cfg.accounts) {
    for (const [accountId, account] of Object.entries(cfg.accounts)) {
      const accountPath = account.webhookPath ?? defaultPath;
      if (!paths.includes(accountPath)) {
        paths.push(accountPath);
      }
    }
  }

  return paths;
}


/**
 * Plugin register function - entry point for host integration.
 * Follows the thin entry pattern with setup CLI, install hint, runtime, and registerChannel.
 */
export function register(api: MoltbotPluginApi): void {
  const config = api.config;

  if (api.registerCli) {
    registerChinaSetupCli(api, { channels: ["wechat-mp"] });
  }

  showChinaInstallHint(api);

  if (api.runtime) {
    setWechatMpRuntime(api.runtime as Record<string, unknown>);
  }

  api.registerChannel({ plugin: wechatMpPlugin });

  const routePaths = collectWechatMpRoutePaths(config ?? {});

  for (const path of routePaths) {
    if (api.registerHttpRoute) {
      api.registerHttpRoute({
        path,
        auth: "plugin",
        match: "exact",
        handler: handleWechatMpWebhookRequest,
      });
    } else if (api.registerHttpHandler) {
      api.registerHttpHandler(handleWechatMpWebhookRequest);
    }
  }
}

export default { register };
