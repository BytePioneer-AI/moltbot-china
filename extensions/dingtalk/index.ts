import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { dingtalkPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";
import { setDingtalkRuntime } from "./src/runtime.js";
import { registerChinaSetupCli, showChinaInstallHint } from "@openclaw-china/shared";

// 导出 ChannelPlugin
export { dingtalkPlugin, DEFAULT_ACCOUNT_ID } from "./src/channel.js";

// 导出发送消息函数
export { sendMessageDingtalk } from "./src/send.js";

// 导出 runtime 管理函数（供外部设置）
export { setDingtalkRuntime, getDingtalkRuntime } from "./src/runtime.js";

// 导出类型
export type {
  DingtalkConfig,
  DingtalkAccountConfig,
  ResolvedDingtalkAccount,
  DingtalkSendResult,
} from "./src/types.js";

export default defineChannelPluginEntry({
  id: "dingtalk",
  name: "DingTalk",
  description: "钉钉消息渠道插件",
  plugin: dingtalkPlugin,
  setRuntime: setDingtalkRuntime,
  registerFull(api) {
    registerChinaSetupCli(api, { channels: ["dingtalk"] });
    showChinaInstallHint(api);
  },
});
