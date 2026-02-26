/**
 * @openclaw-china/qqbot
 * QQ Bot 渠道插件入口
 */

import { qqbotPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
import { setQQBotRuntime, getQQBotRuntime } from "./src/runtime.js";
import { registerChinaSetupCli } from "@openclaw-china/shared";

export interface MoltbotPluginApi {
  registerChannel: (opts: { plugin: unknown }) => void;
  runtime?: unknown;
  [key: string]: unknown;
}

export { qqbotPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
export { setQQBotRuntime, getQQBotRuntime } from "./src/runtime.js";
export type { QQBotConfig, ResolvedQQBotAccount, QQBotSendResult } from "./src/types.js";

const plugin = {
  id: "qqbot",
  name: "QQ Bot",
  description: "QQ 开放平台机器人消息渠道插件",
  configSchema: {
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
          secretKey: { type: "string" }
        }
      },
      markdownSupport: { type: "boolean" },
      dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
      groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
      requireMention: { type: "boolean" },
      allowFrom: { type: "array", items: { type: "string" } },
      groupAllowFrom: { type: "array", items: { type: "string" } },
      historyLimit: { type: "integer", minimum: 0 },
      textChunkLimit: { type: "integer", minimum: 1 },
      replyFinalOnly: { type: "boolean" }
    },
  },

  register(api: MoltbotPluginApi) {
    registerChinaSetupCli(api, { channels: ["qqbot"] });

    if (api.runtime) {
      setQQBotRuntime(api.runtime as Record<string, unknown>);
    }
    api.registerChannel({ plugin: qqbotPlugin });
  },
};

export default plugin;
