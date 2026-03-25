import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ResolvedDingtalkAccount } from "./types.js";
import { dingtalkPluginBase, dingtalkSecurityOptions } from "./channel.shared.js";

export const dingtalkSetupPlugin: ChannelPlugin<ResolvedDingtalkAccount> = createChatChannelPlugin({
  base: dingtalkPluginBase,
  security: dingtalkSecurityOptions,
});
