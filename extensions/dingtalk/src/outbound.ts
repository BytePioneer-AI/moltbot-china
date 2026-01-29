/**
 * 钉钉出站适配器
 *
 * 实现 ChannelOutboundAdapter 接口，提供:
 * - sendText: 发送文本消息
 * - sendMedia: 发送媒体消息（含回退逻辑）
 * - chunker: 长消息分块（利用 Moltbot 核心的 markdown-aware 分块）
 *
 * 配置:
 * - deliveryMode: "direct" (直接发送，不使用队列)
 * - textChunkLimit: 4000 (钉钉 Markdown 消息最大字符数)
 * - chunkerMode: "markdown" (使用 markdown 感知的分块模式)
 */

import { sendMessageDingtalk } from "./send.js";
import { sendMediaDingtalk } from "./media.js";
import { getDingtalkRuntime } from "./runtime.js";
import type { DingtalkConfig } from "./types.js";

/**
 * 出站适配器配置类型
 * 简化版本，仅包含必要字段
 */
export interface OutboundConfig {
  channels?: {
    dingtalk?: DingtalkConfig;
  };
}

/**
 * 发送结果类型
 */
export interface SendResult {
  channel: string;
  messageId: string;
  chatId?: string;
  conversationId?: string;
}

/**
 * 解析目标 ID 和聊天类型
 */
function parseTarget(to: string): { targetId: string; chatType: "direct" | "group" } {
  if (to.startsWith("chat:")) {
    return { targetId: to.slice(5), chatType: "group" };
  }
  if (to.startsWith("user:")) {
    return { targetId: to.slice(5), chatType: "direct" };
  }
  return { targetId: to, chatType: "direct" };
}


/**
 * 钉钉出站适配器
 */
export const dingtalkOutbound = {
  /** 投递模式: direct (直接发送) */
  deliveryMode: "direct" as const,

  /** 文本分块限制: 4000 字符 (钉钉 Markdown 消息限制) */
  textChunkLimit: 4000,

  /** 分块模式: markdown (不会在代码块中间断开) */
  chunkerMode: "markdown" as const,

  /**
   * 长消息分块器
   * 利用 Moltbot 核心的 markdown-aware 分块，不会在代码块中间断开
   */
  chunker: (text: string, limit: number): string[] => {
    try {
      const runtime = getDingtalkRuntime();
      if (runtime.channel?.text?.chunkMarkdownText) {
        return runtime.channel.text.chunkMarkdownText(text, limit);
      }
    } catch {
      // runtime 未初始化，返回原文让 Moltbot 核心处理
    }
    return [text];
  },

  /**
   * 发送文本消息
   */
  sendText: async (params: {
    cfg: OutboundConfig;
    to: string;
    text: string;
  }): Promise<SendResult> => {
    const { cfg, to, text } = params;

    const dingtalkCfg = cfg.channels?.dingtalk;
    if (!dingtalkCfg) {
      throw new Error("DingTalk channel not configured");
    }

    const { targetId, chatType } = parseTarget(to);

    const result = await sendMessageDingtalk({
      cfg: dingtalkCfg,
      to: targetId,
      text,
      chatType,
    });

    return {
      channel: "dingtalk",
      messageId: result.messageId,
      chatId: result.conversationId,
      conversationId: result.conversationId,
    };
  },

  /**
   * 发送媒体消息（含回退逻辑）
   */
  sendMedia: async (params: {
    cfg: OutboundConfig;
    to: string;
    text?: string;
    mediaUrl?: string;
  }): Promise<SendResult> => {
    const { cfg, to, text, mediaUrl } = params;

    const dingtalkCfg = cfg.channels?.dingtalk;
    if (!dingtalkCfg) {
      throw new Error("DingTalk channel not configured");
    }

    const { targetId, chatType } = parseTarget(to);

    // 先发送文本（如果有）
    if (text?.trim()) {
      await sendMessageDingtalk({
        cfg: dingtalkCfg,
        to: targetId,
        text,
        chatType,
      });
    }

    // 发送媒体（如果有 URL）
    if (mediaUrl) {
      try {
        const result = await sendMediaDingtalk({
          cfg: dingtalkCfg,
          to: targetId,
          mediaUrl,
          chatType,
        });

        return {
          channel: "dingtalk",
          messageId: result.messageId,
          chatId: result.conversationId,
          conversationId: result.conversationId,
        };
      } catch (err) {
        // 记录错误并回退到 URL 文本链接
        console.error(`[dingtalk] sendMediaDingtalk failed:`, err);

        const fallbackText = `📎 ${mediaUrl}`;
        const result = await sendMessageDingtalk({
          cfg: dingtalkCfg,
          to: targetId,
          text: fallbackText,
          chatType,
        });

        return {
          channel: "dingtalk",
          messageId: result.messageId,
          chatId: result.conversationId,
          conversationId: result.conversationId,
        };
      }
    }

    // 没有媒体 URL，返回占位结果
    return {
      channel: "dingtalk",
      messageId: text?.trim() ? `text_${Date.now()}` : "empty",
      chatId: targetId,
      conversationId: targetId,
    };
  },
};
