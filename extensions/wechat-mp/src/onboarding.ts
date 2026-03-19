import { DEFAULT_ACCOUNT_ID, resolveDefaultWechatMpAccountId, resolveWechatMpAccount } from "./config.js";
import { getAccountState } from "./state.js";
import type { PluginConfig, WechatMpConfig } from "./types.js";

export interface WizardPrompter {
  note: (message: string, title?: string) => Promise<void>;
}

export const wechatMpOnboardingAdapter = {
  channel: "wechat-mp" as const,

  getStatus: async (params: { cfg: PluginConfig }) => {
    const accountId = resolveDefaultWechatMpAccountId(params.cfg);
    const account = resolveWechatMpAccount({ cfg: params.cfg, accountId });
    const state = await getAccountState(accountId);
    const configured = account.configured;

    return {
      channel: "wechat-mp" as const,
      configured,
      statusLines: [
        configured
          ? `WeChat MP: 已配置${accountId !== DEFAULT_ACCOUNT_ID ? ` (${accountId})` : ""}`
          : "WeChat MP: 需要 appId / token / (safe模式需要 encodingAESKey)",
        `Webhook: ${(account.config.webhookPath ?? "/wechat-mp").trim() || "/wechat-mp"}`,
        `ReplyMode: ${account.config.replyMode ?? "passive"}`,
        state.lastError ? `最近错误: ${state.lastError}` : "最近错误: 无",
      ],
      selectionHint: configured ? "已配置" : "需要基础凭证",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async (params: { cfg: PluginConfig; prompter: WizardPrompter }) => {
    await params.prompter.note(
      [
        "1) 在公众号后台配置服务器地址",
        "2) 准备 AppID / AppSecret / Token",
        "3) safe/compat 模式下额外准备 EncodingAESKey",
        "4) 确认 webhookPath 与宿主网关路由一致",
        "5) P0 默认使用 passive reply，active send 依赖 appSecret",
      ].join("\n"),
      "WeChat MP 配置"
    );
    return {
      cfg: params.cfg,
      accountId: resolveDefaultWechatMpAccountId(params.cfg),
    };
  },

  disable: (cfg: PluginConfig): PluginConfig => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      "wechat-mp": {
        ...(cfg.channels?.["wechat-mp"] as WechatMpConfig | undefined),
        enabled: false,
      },
    },
  }),
};
