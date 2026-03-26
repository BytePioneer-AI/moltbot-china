/**
 * @openclaw-china/wecom-app
 * 企业微信自建应用渠道插件入口
 *
 * 导出:
 * - wecomAppPlugin: ChannelPlugin 实现
 * - DEFAULT_ACCOUNT_ID: 默认账户 ID
 * - setWecomAppRuntime: 设置 Moltbot 运行时
 * - sendWecomAppMessage: 主动发送消息
 * - getAccessToken: 获取 Access Token
 */

import type { IncomingMessage, ServerResponse } from "http";
import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";

import { registerChinaSetupCli, showChinaInstallHint } from "@openclaw-china/shared";

import { wecomAppPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
import { setWecomAppRuntime, getWecomAppRuntime } from "./src/runtime.js";
import { handleWecomAppWebhookRequest } from "./src/monitor.js";
import {
  sendWecomAppMessage,
  sendWecomAppMarkdownMessage,
  getAccessToken,
  stripMarkdown,
  clearAccessTokenCache,
  clearAllAccessTokenCache,
} from "./src/api.js";

type HttpRouteMatch = "exact" | "prefix";
type HttpRouteAuth = "gateway" | "plugin";

type HttpRouteParams = {
  path: string;
  auth: HttpRouteAuth;
  match?: HttpRouteMatch;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
};

type WecomAppRouteConfig = {
  webhookPath?: string;
  accounts?: Record<
    string,
    {
      webhookPath?: string;
    }
  >;
};

type LegacyHttpHandlerApi = Omit<OpenClawPluginApi, "registerHttpRoute"> & {
  registerHttpRoute?: (params: HttpRouteParams) => void;
  registerHttpHandler?: (handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean) => void;
  config?: {
    channels?: {
      "wecom-app"?: WecomAppRouteConfig;
    };
  };
};

function normalizeRoutePath(path: string | undefined, fallback: string): string {
  const trimmed = path?.trim() ?? "";
  const candidate = trimmed || fallback;
  return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

function collectWecomAppRoutePaths(config: WecomAppRouteConfig | undefined): string[] {
  const routes = new Set<string>([normalizeRoutePath(config?.webhookPath, "/wecom-app")]);
  for (const accountConfig of Object.values(config?.accounts ?? {})) {
    const customPath = accountConfig?.webhookPath?.trim();
    if (!customPath) continue;
    routes.add(normalizeRoutePath(customPath, "/wecom-app"));
  }
  return [...routes];
}

// 导出 ChannelPlugin
export { wecomAppPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";

// 导出 runtime 管理函数
export { setWecomAppRuntime, getWecomAppRuntime } from "./src/runtime.js";

// 导出 API 函数 (主动发送消息)
export {
  sendWecomAppMessage,
  sendWecomAppMarkdownMessage,
  getAccessToken,
  stripMarkdown,
  clearAccessTokenCache,
  clearAllAccessTokenCache,
  downloadAndSendImage,
  sendWecomAppImageMessage,
} from "./src/api.js";

// 导出封装发送函数 (业务层推荐使用)
export {
  sendWecomDM,
  sendWecom,
  normalizeTarget,
  parseTarget,
  type SendMessageOptions,
  type SendResult,
} from "./src/send.js";

// 导出类型
export type {
  WecomAppConfig,
  ResolvedWecomAppAccount,
  WecomAppInboundMessage,
  WecomAppDmPolicy,
  WecomAppSendTarget,
  AccessTokenCacheEntry,
} from "./src/types.js";

const baseEntry = defineChannelPluginEntry({
  id: "wecom-app",
  name: "WeCom App",
  description: "企业微信自建应用插件，支持主动发送消息",
  plugin: wecomAppPlugin,
  setRuntime: setWecomAppRuntime,
  registerFull(api) {
    registerChinaSetupCli(api, { channels: ["wecom-app"] });
    showChinaInstallHint(api);

    const routeApi = api as LegacyHttpHandlerApi;
    const routeConfig = api.config?.channels?.["wecom-app"] as WecomAppRouteConfig | undefined;

    if (typeof routeApi.registerHttpRoute === "function") {
      for (const path of collectWecomAppRoutePaths(routeConfig)) {
        routeApi.registerHttpRoute({
          path,
          auth: "plugin",
          match: "prefix",
          handler: handleWecomAppWebhookRequest,
        });
      }
    } else if (typeof routeApi.registerHttpHandler === "function") {
      // Preserve legacy host shims while migrating to the latest SDK entry.
      routeApi.registerHttpHandler(handleWecomAppWebhookRequest);
    }
  },
});

const plugin = {
  ...baseEntry,
  register(api: LegacyHttpHandlerApi) {
    baseEntry.register({
      ...api,
      registrationMode: api.registrationMode ?? "full",
    } as OpenClawPluginApi);
  },
};

export default plugin;
