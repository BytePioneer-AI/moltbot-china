/**
 * @openclaw-china/wecom-kh
 * 企业微信客户渠道插件入口
 */

import type { IncomingMessage, ServerResponse } from "http";

import { wecomKhPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
import { setWecomKhRuntime, getWecomKhRuntime } from "./src/runtime.js";
import { handleWecomKhWebhookRequest } from "./src/monitor.js";
import { registerChinaSetupCli, showChinaInstallHint } from "@openclaw-china/shared";

type HttpRouteMatch = "exact" | "prefix";
type HttpRouteAuth = "gateway" | "plugin";

type HttpRouteParams = {
  path: string;
  auth: HttpRouteAuth;
  match?: HttpRouteMatch;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
};

type WecomKhRouteConfig = {
  webhookPath?: string;
  accounts?: Record<
    string,
    {
      webhookPath?: string;
    }
  >;
};

export interface MoltbotPluginApi {
  registerChannel: (opts: { plugin: unknown }) => void;
  registerHttpHandler?: (handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean) => void;
  registerHttpRoute?: (params: HttpRouteParams) => void;
  config?: {
    channels?: {
      "wecom-kh"?: WecomKhRouteConfig;
    };
  };
  runtime?: unknown;
  [key: string]: unknown;
}

function normalizeRoutePath(path: string | undefined, fallback: string): string {
  const trimmed = path?.trim() ?? "";
  const candidate = trimmed || fallback;
  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

function collectWecomKhRoutePaths(config: WecomKhRouteConfig | undefined): string[] {
  const routes = new Set<string>([normalizeRoutePath(config?.webhookPath, "/wecom-kh")]);
  for (const accountConfig of Object.values(config?.accounts ?? {})) {
    const customPath = accountConfig?.webhookPath?.trim();
    if (!customPath) continue;
    routes.add(normalizeRoutePath(customPath, "/wecom-kh"));
  }
  return [...routes];
}

// 导出 ChannelPlugin
export { wecomKhPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";

// 导出 runtime 管理函数
export { setWecomKhRuntime, getWecomKhRuntime } from "./src/runtime.js";

// 导出 API 函数
export {
  sendKhMessage,
  sendKhImageMessage,
  sendKhFileMessage,
  getAccessToken,
  syncMessages,
  stripMarkdown,
  uploadMedia,
  clearAccessTokenCache,
  clearAllAccessTokenCache,
} from "./src/api.js";

// 导出类型
export type {
  WecomKhConfig,
  ResolvedWecomKhAccount,
  WecomKhInboundMessage,
  WecomKhSendTarget,
} from "./src/types.js";

const plugin = {
  id: "wecom-kh",
  name: "WeCom KH",
  description: "企业微信客户渠道插件",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  register(api: MoltbotPluginApi) {
    registerChinaSetupCli(api, { channels: ["wecom-app", "wecom-kh", "wecom-kf"] });
    showChinaInstallHint(api);

    if (api.runtime) {
      setWecomKhRuntime(api.runtime as Record<string, unknown>);
    }

    api.registerChannel({ plugin: wecomKhPlugin });

    if (api.registerHttpRoute) {
      for (const path of collectWecomKhRoutePaths(api.config?.channels?.["wecom-kh"])) {
        api.registerHttpRoute({
          path,
          auth: "plugin",
          match: "prefix",
          handler: handleWecomKhWebhookRequest,
        });
      }
    } else if (api.registerHttpHandler) {
      api.registerHttpHandler(handleWecomKhWebhookRequest);
    }
  },
};

export default plugin;
