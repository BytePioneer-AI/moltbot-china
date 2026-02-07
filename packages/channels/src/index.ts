/**
 * @openclaw-china/channels
 * 统一渠道包入口
 *
 * 导出所有渠道插件，提供统一注册函数
 *
 * Requirements: Unified Package Entry, Unified Distribution
 */

// 导出 DingTalk 插件
import {
  dingtalkPlugin,
  DEFAULT_ACCOUNT_ID as DINGTALK_DEFAULT_ACCOUNT_ID,
  sendMessageDingtalk,
  setDingtalkRuntime,
  getDingtalkRuntime,
} from "@openclaw-china/dingtalk";
import dingtalkEntry from "@openclaw-china/dingtalk";
import {
  feishuPlugin,
  DEFAULT_ACCOUNT_ID as FEISHU_DEFAULT_ACCOUNT_ID,
  sendMessageFeishu,
  setFeishuRuntime,
  getFeishuRuntime,
} from "@openclaw-china/feishu-china";
import feishuEntry from "@openclaw-china/feishu-china";
import {
  wecomPlugin,
  DEFAULT_ACCOUNT_ID as WECOM_DEFAULT_ACCOUNT_ID,
  setWecomRuntime,
  getWecomRuntime,
} from "@openclaw-china/wecom";
import wecomEntry from "@openclaw-china/wecom";
import {
  wecomAppPlugin,
  DEFAULT_ACCOUNT_ID as WECOM_APP_DEFAULT_ACCOUNT_ID,
  setWecomAppRuntime,
  getWecomAppRuntime,
  sendWecomAppMessage,
  getAccessToken,
  sendWecomAppMarkdownMessage,
  stripMarkdown,
  clearAccessTokenCache,
  clearAllAccessTokenCache,
  downloadAndSendImage,
  sendWecomAppImageMessage,
} from "@openclaw-china/wecom-app";
import wecomAppEntry from "@openclaw-china/wecom-app";
import {
  qqbotPlugin,
  DEFAULT_ACCOUNT_ID as QQBOT_DEFAULT_ACCOUNT_ID,
  setQQBotRuntime,
  getQQBotRuntime,
} from "@openclaw-china/qqbot";
import qqbotEntry from "@openclaw-china/qqbot";

export {
  dingtalkPlugin,
  DINGTALK_DEFAULT_ACCOUNT_ID,
  sendMessageDingtalk,
  setDingtalkRuntime,
  getDingtalkRuntime,
  feishuPlugin,
  FEISHU_DEFAULT_ACCOUNT_ID,
  sendMessageFeishu,
  setFeishuRuntime,
  getFeishuRuntime,
  wecomPlugin,
  WECOM_DEFAULT_ACCOUNT_ID,
  setWecomRuntime,
  getWecomRuntime,
  wecomAppPlugin,
  WECOM_APP_DEFAULT_ACCOUNT_ID,
  setWecomAppRuntime,
  getWecomAppRuntime,
  sendWecomAppMessage,
  getAccessToken,
  sendWecomAppMarkdownMessage,
  stripMarkdown,
  clearAccessTokenCache,
  clearAllAccessTokenCache,
  downloadAndSendImage,
  sendWecomAppImageMessage,
  qqbotPlugin,
  QQBOT_DEFAULT_ACCOUNT_ID,
  setQQBotRuntime,
  getQQBotRuntime,
};

export type {
  DingtalkConfig,
  ResolvedDingtalkAccount,
  DingtalkSendResult,
} from "@openclaw-china/dingtalk";
export type {
  FeishuConfig,
  ResolvedFeishuAccount,
  FeishuSendResult,
} from "@openclaw-china/feishu-china";
export type { WecomConfig, ResolvedWecomAccount, WecomInboundMessage } from "@openclaw-china/wecom";
export type {
  WecomAppConfig,
  ResolvedWecomAppAccount,
  WecomAppInboundMessage,
  WecomAppDmPolicy,
  WecomAppSendTarget,
  AccessTokenCacheEntry,
} from "@openclaw-china/wecom-app";
export type { QQBotConfig, ResolvedQQBotAccount, QQBotSendResult } from "@openclaw-china/qqbot";

// TODO: 后续添加其他渠道
// export { qqPlugin } from "@openclaw-china/qq";

/**
 * 渠道配置接口
 */
export interface ChannelConfig {
  /** 是否启用该渠道 */
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Moltbot 配置接口（符合官方约定）
 * 配置路径: channels.<id>.enabled
 */
export interface MoltbotConfig {
  channels?: {
    dingtalk?: ChannelConfig;
    "feishu-china"?: ChannelConfig;
    wecom?: ChannelConfig;
    "wecom-app"?: ChannelConfig;
    qqbot?: ChannelConfig;
    qq?: ChannelConfig;
    [key: string]: ChannelConfig | undefined;
  };
  [key: string]: unknown;
}

/**
 * Moltbot 插件 API 接口
 */
export interface MoltbotPluginApi {
  registerChannel: (opts: { plugin: unknown }) => void;
  runtime?: unknown;
  config?: MoltbotConfig;
  [key: string]: unknown;
}

/**
 * 支持的渠道列表
 */
export const SUPPORTED_CHANNELS = ["dingtalk", "feishu-china", "wecom", "wecom-app", "qqbot"] as const;
// TODO: 后续添加 "qq"

export type SupportedChannel = (typeof SUPPORTED_CHANNELS)[number];

const channelPlugins: Record<SupportedChannel, { register: (api: MoltbotPluginApi) => void }> = {
  dingtalk: {
    register: (api: MoltbotPluginApi) => {
      dingtalkEntry.register(api);
    },
  },
  "feishu-china": {
    register: (api: MoltbotPluginApi) => {
      feishuEntry.register(api);
    },
  },
  wecom: {
    register: (api: MoltbotPluginApi) => {
      wecomEntry.register(api);
    },
  },
  "wecom-app": {
    register: (api: MoltbotPluginApi) => {
      wecomAppEntry.register(api);
    },
  },
  qqbot: {
    register: (api: MoltbotPluginApi) => {
      qqbotEntry.register(api);
    },
  },
};

/**
 * 根据 Moltbot 配置注册启用的渠道
 *
 * 符合 Moltbot 官方约定：从 cfg.channels.<id>.enabled 读取配置
 *
 * @param api Moltbot 插件 API
 * @param cfg Moltbot 配置（可选，默认从 api.config 读取）
 *
 * @example
 * ```ts
 * // moltbot.json 配置
 * {
 *   "channels": {
 *     "dingtalk": {
 *       "enabled": true,
 *       "clientId": "...",
 *       "clientSecret": "..."
 *     }
 *   }
 * }
 * ```
 */
export function registerChannelsByConfig(
  api: MoltbotPluginApi,
  cfg?: MoltbotConfig
): void {
  // 从 api.config 或传入的 cfg 获取配置
  const config = cfg ?? api.config;
  const channelsConfig = config?.channels;

  if (!channelsConfig) {
    return;
  }

  for (const channelId of SUPPORTED_CHANNELS) {
    // 符合官方约定：从 channels.<id>.enabled 读取
    const channelConfig = channelsConfig[channelId];

    // 跳过未启用的渠道
    if (!channelConfig?.enabled) {
      continue;
    }

    const plugin = channelPlugins[channelId];
    plugin.register(api);
  }
}

/**
 * 统一渠道插件定义
 *
 * 包含所有支持的渠道，通过配置启用
 * 配置路径符合 Moltbot 官方约定: channels.<id>
 */
const channelsPlugin = {
  id: "channels",
  name: "Moltbot China Channels",
  description: "统一渠道包，支持钉钉、飞书、企业微信、QQ Bot",

  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },

  /**
   * 注册所有启用的渠道
   *
   * 从 api.config.channels.<id>.enabled 读取配置
   */
  register(api: MoltbotPluginApi) {
    registerChannelsByConfig(api);
  },
};

export default channelsPlugin;
