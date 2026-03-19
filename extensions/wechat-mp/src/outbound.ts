import { resolveWechatMpAccount } from "./config.js";
import { sendWechatMpActiveText } from "./send.js";
import type { PluginConfig } from "./types.js";

function parseTarget(rawTarget: string): { accountId?: string; openId: string } | null {
  let raw = String(rawTarget ?? "").trim();
  if (!raw) return null;
  if (/^wechat-mp:/i.test(raw)) {
    raw = raw.slice("wechat-mp:".length);
  }
  let accountId: string | undefined;
  const atIndex = raw.lastIndexOf("@");
  if (atIndex > 0 && atIndex < raw.length - 1) {
    accountId = raw.slice(atIndex + 1).trim();
    raw = raw.slice(0, atIndex);
  }
  if (/^user:/i.test(raw)) {
    raw = raw.slice("user:".length);
  }
  const openId = raw.trim();
  return openId ? { accountId, openId } : null;
}

export const wechatMpOutbound = {
  deliveryMode: "direct" as const,
  textChunkLimit: 600,

  sendText: async (params: {
    cfg: PluginConfig;
    accountId?: string;
    to: string;
    text: string;
  }) => {
    const parsed = parseTarget(params.to);
    if (!parsed) {
      return {
        channel: "wechat-mp",
        ok: false,
        messageId: "",
        error: new Error(`Unsupported target for WeChat MP: ${params.to}`),
      };
    }

    const account = resolveWechatMpAccount({
      cfg: params.cfg,
      accountId: parsed.accountId ?? params.accountId,
    });
    const result = await sendWechatMpActiveText({
      account,
      toUserName: parsed.openId,
      text: params.text,
    });
    return {
      channel: "wechat-mp",
      ok: result.ok,
      messageId: result.msgid ?? "",
      error: result.ok ? undefined : new Error(result.error ?? "send failed"),
    };
  },
};
