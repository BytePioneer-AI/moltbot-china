/**
 * 钉钉 AI Card 流式响应
 *
 * 提供:
 * - createAICard: 创建 AI Card 实例
 * - streamAICard: 流式更新卡片内容
 * - finishAICard: 完成卡片
 *
 * API 文档:
 * - 创建卡片: https://open.dingtalk.com/document/orgapp/create-card-instances
 * - 流式更新: https://open.dingtalk.com/document/orgapp/streaming-card-updates
 */

import { getAccessToken } from "./client.js";
import type { DingtalkConfig } from "./types.js";

/** 钉钉 API 基础 URL */
const DINGTALK_API_BASE = "https://api.dingtalk.com";

/** AI Card 模板 ID */
const AI_CARD_TEMPLATE_ID = "382e4302-551d-4880-bf29-a30acfab2e71.schema";

/** AI Card 状态 */
const AICardStatus = {
  PROCESSING: "1",
  INPUTING: "2",
  FINISHED: "3",
  EXECUTING: "4",
  FAILED: "5",
} as const;

/** HTTP 请求超时时间（毫秒） */
const REQUEST_TIMEOUT = 30000;

/**
 * AI Card 实例
 */
export interface AICardInstance {
  /** 卡片实例 ID */
  cardInstanceId: string;
  /** Access Token */
  accessToken: string;
  /** 是否已开始流式更新 */
  inputingStarted: boolean;
}

/**
 * 创建 AI Card 参数
 */
export interface CreateAICardParams {
  /** 钉钉配置 */
  cfg: DingtalkConfig;
  /** 会话类型: "1" = 单聊, "2" = 群聊 */
  conversationType: "1" | "2";
  /** 会话 ID */
  conversationId: string;
  /** 发送者 ID（单聊时使用） */
  senderId?: string;
  /** 发送者 staffId（单聊时使用） */
  senderStaffId?: string;
  /** 日志函数 */
  log?: (msg: string) => void;
}

/**
 * 创建 AI Card 实例
 *
 * 流程:
 * 1. 获取 Access Token
 * 2. 创建卡片实例 (POST /v1.0/card/instances)
 * 3. 投放卡片 (POST /v1.0/card/instances/deliver)
 *
 * @param params 创建参数
 * @returns AI Card 实例或 null（失败时）
 */
export async function createAICard(
  params: CreateAICardParams
): Promise<AICardInstance | null> {
  const { cfg, conversationType, conversationId, senderId, senderStaffId, log } = params;

  // 验证凭证
  if (!cfg.clientId || !cfg.clientSecret) {
    log?.(`[AICard] Error: DingTalk credentials not configured`);
    return null;
  }

  try {
    // 获取 Access Token
    const accessToken = await getAccessToken(cfg.clientId, cfg.clientSecret);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.(`[AICard] Creating card instance: ${cardInstanceId}`);

    // 1. 创建卡片实例
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: {
        cardParamMap: {},
      },
      callbackType: "STREAM",
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    const createController = new AbortController();
    const createTimeoutId = setTimeout(() => createController.abort(), REQUEST_TIMEOUT);

    try {
      const createResp = await fetch(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": accessToken,
        },
        body: JSON.stringify(createBody),
        signal: createController.signal,
      });

      if (!createResp.ok) {
        const errorText = await createResp.text();
        log?.(`[AICard] Failed to create card: HTTP ${createResp.status} - ${errorText}`);
        return null;
      }

      log?.(`[AICard] Card instance created successfully`);

      // 2. 投放卡片
      const isGroup = conversationType === "2";
      const deliverBody: Record<string, unknown> = {
        outTrackId: cardInstanceId,
        userIdType: 1,
      };

      if (isGroup) {
        deliverBody.openSpaceId = `dtv1.card//IM_GROUP.${conversationId}`;
        deliverBody.imGroupOpenDeliverModel = {
          robotCode: cfg.clientId,
        };
      } else {
        const userId = senderStaffId || senderId;
        if (!userId) {
          log?.("[AICard] Error: missing senderStaffId/senderId for IM_ROBOT delivery");
          return null;
        }
        deliverBody.openSpaceId = `dtv1.card//IM_ROBOT.${userId}`;
        deliverBody.imRobotOpenDeliverModel = { spaceType: "IM_ROBOT" };
      }

      const deliverController = new AbortController();
      const deliverTimeoutId = setTimeout(() => deliverController.abort(), REQUEST_TIMEOUT);

      try {
        const deliverResp = await fetch(`${DINGTALK_API_BASE}/v1.0/card/instances/deliver`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-acs-dingtalk-access-token": accessToken,
          },
          body: JSON.stringify(deliverBody),
          signal: deliverController.signal,
        });

        if (!deliverResp.ok) {
          const errorText = await deliverResp.text();
          log?.(`[AICard] Failed to deliver card: HTTP ${deliverResp.status} - ${errorText}`);
          return null;
        }

        log?.(`[AICard] Card delivered successfully`);

        return {
          cardInstanceId,
          accessToken,
          inputingStarted: false,
        };
      } finally {
        clearTimeout(deliverTimeoutId);
      }
    } finally {
      clearTimeout(createTimeoutId);
    }
  } catch (err) {
    log?.(`[AICard] Error creating card: ${String(err)}`);
    return null;
  }
}

/**
 * 流式更新 AI Card 内容
 *
 * 流程:
 * 1. 首次调用时，先切换到 INPUTING 状态
 * 2. 调用 streaming API 更新内容
 *
 * @param card AI Card 实例
 * @param content 更新的内容
 * @param finished 是否完成
 * @param log 日志函数
 * @throws Error 如果更新失败
 */
export async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  log?: (msg: string) => void
): Promise<void> {
  // 首次流式更新前，先切换到 INPUTING 状态
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: "",
          staticMsgContent: "",
          sys_full_json_obj: JSON.stringify({
            order: ["msgContent"],
          }),
        },
      },
    };

    const statusController = new AbortController();
    const statusTimeoutId = setTimeout(() => statusController.abort(), REQUEST_TIMEOUT);

    try {
      const statusResp = await fetch(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": card.accessToken,
        },
        body: JSON.stringify(statusBody),
        signal: statusController.signal,
      });

      if (!statusResp.ok) {
        const errorText = await statusResp.text();
        throw new Error(`Failed to switch to INPUTING: HTTP ${statusResp.status} - ${errorText}`);
      }

      log?.(`[AICard] Switched to INPUTING state`);
    } finally {
      clearTimeout(statusTimeoutId);
    }

    card.inputingStarted = true;
  }

  // 调用 streaming API 更新内容
  const streamBody = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: "msgContent",
    content: content,
    isFull: true,
    isFinalize: finished,
    isError: false,
  };

  const streamController = new AbortController();
  const streamTimeoutId = setTimeout(() => streamController.abort(), REQUEST_TIMEOUT);

  try {
    const streamResp = await fetch(`${DINGTALK_API_BASE}/v1.0/card/streaming`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": card.accessToken,
      },
      body: JSON.stringify(streamBody),
      signal: streamController.signal,
    });

    if (!streamResp.ok) {
      const errorText = await streamResp.text();
      throw new Error(`Failed to stream update: HTTP ${streamResp.status} - ${errorText}`);
    }

    if (!finished) {
      log?.(`[AICard] Streamed ${content.length} chars`);
    }
  } finally {
    clearTimeout(streamTimeoutId);
  }
}

/**
 * 完成 AI Card
 *
 * 流程:
 * 1. 用最终内容关闭流式通道 (isFinalize=true)
 * 2. 更新卡片状态为 FINISHED
 *
 * @param card AI Card 实例
 * @param content 最终内容
 * @param log 日志函数
 */
export async function finishAICard(
  card: AICardInstance,
  content: string,
  log?: (msg: string) => void
): Promise<void> {
  log?.(`[AICard] Finishing card with ${content.length} chars`);

  // 1. 用最终内容关闭流式通道
  await streamAICard(card, content, true, log);

  // 2. 更新卡片状态为 FINISHED
  const finishBody = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: content,
        staticMsgContent: "",
        sys_full_json_obj: JSON.stringify({
          order: ["msgContent"],
        }),
      },
    },
  };

  const finishController = new AbortController();
  const finishTimeoutId = setTimeout(() => finishController.abort(), REQUEST_TIMEOUT);

  try {
    const finishResp = await fetch(`${DINGTALK_API_BASE}/v1.0/card/instances`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": card.accessToken,
      },
      body: JSON.stringify(finishBody),
      signal: finishController.signal,
    });

    if (!finishResp.ok) {
      const errorText = await finishResp.text();
      log?.(`[AICard] Warning: Failed to set FINISHED state: HTTP ${finishResp.status}`);
    } else {
      log?.(`[AICard] Card finished successfully`);
    }
  } finally {
    clearTimeout(finishTimeoutId);
  }
}
