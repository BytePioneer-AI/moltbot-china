import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ResolvedDingtalkAccount } from "./types.js";
import { DEFAULT_ACCOUNT_ID, mergeDingtalkAccountConfig, resolveDingtalkAccountId, type PluginConfig } from "./config.js";
import { dingtalkMessageActions } from "./actions.js";
import { dingtalkPluginBase, dingtalkSecurityOptions } from "./channel.shared.js";
import {
  monitorDingtalkProvider,
  stopDingtalkMonitorForAccount,
} from "./monitor.js";
import { dingtalkOutbound } from "./outbound.js";
import { sendMessageDingtalk } from "./send.js";

export { DEFAULT_ACCOUNT_ID } from "./config.js";

export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = createChatChannelPlugin({
  base: {
    ...dingtalkPluginBase,
    actions: dingtalkMessageActions,
    outbound: dingtalkOutbound as NonNullable<ChannelPlugin<ResolvedDingtalkAccount>["outbound"]>,
    gateway: {
      startAccount: async (ctx) => {
        ctx.setStatus({
          ...ctx.getStatus(),
          accountId: ctx.accountId,
        });

        ctx.log?.info?.(`[dingtalk] starting provider for account ${ctx.accountId}`);

        return await monitorDingtalkProvider({
          config: ctx.cfg as PluginConfig,
          runtime: {
            log: (message) => ctx.log?.info?.(message),
            error: (message) => ctx.log?.error?.(message),
          },
          abortSignal: ctx.abortSignal,
          accountId: ctx.accountId,
          setStatus: (status) =>
            ctx.setStatus({
              ...ctx.getStatus(),
              ...(status as Record<string, unknown>),
            }),
        });
      },
      stopAccount: async (ctx) => {
        stopDingtalkMonitorForAccount(ctx.accountId);
      },
    },
  },
  security: dingtalkSecurityOptions,
  pairing: {
    text: {
      idLabel: "dingtalkUserId",
      message: "Your pairing request has been approved.",
      normalizeAllowEntry: (entry) => entry.trim().toLowerCase(),
      notify: async ({ cfg, id, message, accountId }) => {
        const dingtalkCfg = mergeDingtalkAccountConfig(
          cfg as PluginConfig,
          resolveDingtalkAccountId(cfg as PluginConfig, accountId),
        );
        await sendMessageDingtalk({
          cfg: dingtalkCfg,
          to: id,
          text: message,
          chatType: "direct",
        });
      },
    },
  },
});
