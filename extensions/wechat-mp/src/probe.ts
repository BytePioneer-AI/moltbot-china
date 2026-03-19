import { resolveWechatMpAccount } from "./config.js";
import { getAccessToken } from "./token.js";
import { getAccountState } from "./state.js";
import type { PluginConfig } from "./types.js";

export async function probeWechatMpAccount(params: {
  cfg: PluginConfig;
  accountId?: string;
}): Promise<{
  channel: "wechat-mp";
  accountId: string;
  configured: boolean;
  canSendActive: boolean;
  webhookPath?: string;
  authOk: boolean;
  lastInboundAt?: number;
  error?: string;
}> {
  const account = resolveWechatMpAccount({ cfg: params.cfg, accountId: params.accountId });
  const state = await getAccountState(account.accountId);

  if (!account.configured) {
    return {
      channel: "wechat-mp",
      accountId: account.accountId,
      configured: false,
      canSendActive: account.canSendActive,
      webhookPath: account.config.webhookPath ?? "/wechat-mp",
      authOk: false,
      lastInboundAt: state.lastInboundAt,
      error: "missing appId/token/(encodingAESKey for safe/compat)",
    };
  }

  if (!account.canSendActive) {
    return {
      channel: "wechat-mp",
      accountId: account.accountId,
      configured: true,
      canSendActive: false,
      webhookPath: account.config.webhookPath ?? "/wechat-mp",
      authOk: true,
      lastInboundAt: state.lastInboundAt,
    };
  }

  try {
    await getAccessToken(account);
    return {
      channel: "wechat-mp",
      accountId: account.accountId,
      configured: true,
      canSendActive: true,
      webhookPath: account.config.webhookPath ?? "/wechat-mp",
      authOk: true,
      lastInboundAt: state.lastInboundAt,
    };
  } catch (error) {
    return {
      channel: "wechat-mp",
      accountId: account.accountId,
      configured: true,
      canSendActive: true,
      webhookPath: account.config.webhookPath ?? "/wechat-mp",
      authOk: false,
      lastInboundAt: state.lastInboundAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
