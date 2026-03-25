import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
} from "openclaw/plugin-sdk/channel-contract";
import { extractToolSend } from "openclaw/plugin-sdk/tool-send";
import {
  listDingtalkAccountIds,
  mergeDingtalkAccountConfig,
  resolveDingtalkAccountId,
  resolveDingtalkCredentials,
  type PluginConfig,
} from "./config.js";
import { sendMediaDingtalk } from "./media.js";
import { sendMessageDingtalk } from "./send.js";
import { parseDingtalkSendTarget } from "./targets.js";

function listEnabledConfiguredAccounts(cfg: PluginConfig): string[] {
  return listDingtalkAccountIds(cfg).filter((accountId) => {
    const account = mergeDingtalkAccountConfig(cfg, accountId);
    return account.enabled !== false && Boolean(resolveDingtalkCredentials(account));
  });
}

export const dingtalkMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: ({ cfg }) => {
    const accounts = listEnabledConfiguredAccounts(cfg as PluginConfig);
    if (accounts.length === 0) {
      return null;
    }

    const actions = new Set<ChannelMessageActionName>(["send", "sendAttachment"]);
    return {
      actions: Array.from(actions),
      capabilities: [],
    };
  },
  extractToolSend: ({ args }) => extractToolSend(args, "sendMessage"),
  handleAction: async ({ action, params, cfg, accountId }) => {
    if (action !== "send" && action !== "sendAttachment") {
      throw new Error(`Action ${action} is not supported for DingTalk.`);
    }

    const to = readStringParam(params, "to", { required: true });
    const text =
      readStringParam(params, "message", { allowEmpty: true }) ??
      readStringParam(params, "text", { allowEmpty: true });
    const caption = readStringParam(params, "caption", { allowEmpty: true });
    const mediaUrl =
      readStringParam(params, "media", { trim: false }) ??
      readStringParam(params, "mediaUrl", { trim: false }) ??
      readStringParam(params, "path", { trim: false }) ??
      readStringParam(params, "filePath", { trim: false });
    const base64Buffer = readStringParam(params, "buffer", { trim: false });
    const fileName = readStringParam(params, "filename", { trim: false });
    const contentType =
      readStringParam(params, "contentType", { trim: false }) ??
      readStringParam(params, "mimeType", { trim: false });

    const resolvedAccountId = resolveDingtalkAccountId(cfg as PluginConfig, accountId);
    const dingtalkCfg = mergeDingtalkAccountConfig(cfg as PluginConfig, resolvedAccountId);
    const resolvedTarget = parseDingtalkSendTarget(to);
    if (!resolvedTarget) {
      throw new Error(`Invalid DingTalk target: ${to}`);
    }
    const mediaBuffer = base64Buffer ? Buffer.from(base64Buffer, "base64") : undefined;
    const mediaProvided = Boolean(mediaUrl || mediaBuffer);
    const attachmentText = caption ?? text ?? "";

    if (mediaProvided) {
      if (attachmentText.trim()) {
        await sendMessageDingtalk({
          cfg: dingtalkCfg,
          to: resolvedTarget.targetId,
          text: attachmentText,
          chatType: resolvedTarget.chatType,
        });
      }
      const result = await sendMediaDingtalk({
        cfg: dingtalkCfg,
        to: resolvedTarget.targetId,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(mediaBuffer ? { mediaBuffer } : {}),
        ...(fileName ? { fileName } : {}),
        ...(contentType ? { contentType } : {}),
        chatType: resolvedTarget.chatType,
      });
      return jsonResult({ ok: true, to: resolvedTarget.normalized, messageId: result.messageId });
    }

    if (action === "sendAttachment") {
      throw new Error(
        "DingTalk sendAttachment requires media, path/filePath, or buffer parameters.",
      );
    }

    const content = text ?? "";
    if (!content.trim()) {
      throw new Error("DingTalk send action requires message text when no media is provided.");
    }

    const result = await sendMessageDingtalk({
      cfg: dingtalkCfg,
      to: resolvedTarget.targetId,
      text: content,
      chatType: resolvedTarget.chatType,
    });
    return jsonResult({ ok: true, to: resolvedTarget.normalized, messageId: result.messageId });
  },
};
