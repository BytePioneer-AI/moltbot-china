/**
 * 钉钉 Stream 连接管理
 * 
 * 使用 dingtalk-stream SDK 建立持久连接接收消息
 * 
 */

import { DWClient, TOPIC_ROBOT, EventAck } from "dingtalk-stream";
import { createDingtalkClientFromConfig } from "./client.js";
import { handleDingtalkMessage } from "./bot.js";
import type { DingtalkConfig } from "./config.js";
import type { DingtalkRawMessage } from "./types.js";

function hashText(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Monitor 配置选项
 */
export interface MonitorDingtalkOpts {
  /** 钉钉渠道配置 */
  config?: {
    channels?: {
      dingtalk?: DingtalkConfig;
    };
  };
  /** 运行时环境 */
  runtime?: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  /** 中断信号，用于优雅关闭 */
  abortSignal?: AbortSignal;
  /** 账户 ID */
  accountId?: string;
}

/** 当前活跃的 Stream 客户端 */
let currentClient: DWClient | null = null;

/** 当前活跃连接的账户 ID */
let currentAccountId: string | null = null;

/** 当前 Monitor Promise */
let currentPromise: Promise<void> | null = null;

/** 停止当前 Monitor */
let currentStop: (() => void) | null = null;

/**
 * 消息去重缓存
 * 使用 Set 存储已处理的消息 ID，防止重复处理
 */
const processedMessageIds = new Set<string>();

/** 去重缓存最大容量 */
const DEDUP_CACHE_MAX_SIZE = 10000;

/** 去重缓存过期时间（毫秒）- 5 分钟 */
const DEDUP_CACHE_TTL = 5 * 60 * 1000;

/** 去重缓存条目（带时间戳） */
const processedMessageTimestamps = new Map<string, number>();

/** 短 TTL 内容签名去重（毫秒） */
const SIGNATURE_TTL_MS = 100 * 1000;

/** 内容签名缓存条目（带时间戳） */
const recentSignatureTimestamps = new Map<string, number>();

/**
 * 清理过期的去重缓存条目
 */
function cleanupDedupCache(): void {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessageTimestamps) {
    if (now - timestamp > DEDUP_CACHE_TTL) {
      processedMessageIds.delete(messageId);
      processedMessageTimestamps.delete(messageId);
    }
  }
}

function cleanupSignatureCache(now: number): void {
  for (const [key, timestamp] of recentSignatureTimestamps) {
    if (now - timestamp > SIGNATURE_TTL_MS) {
      recentSignatureTimestamps.delete(key);
    }
  }
}

function isSignatureDuplicate(signature: string, now: number): boolean {
  cleanupSignatureCache(now);
  const lastSeen = recentSignatureTimestamps.get(signature);
  if (lastSeen && now - lastSeen < SIGNATURE_TTL_MS) {
    return true;
  }
  recentSignatureTimestamps.set(signature, now);
  return false;
}

/**
 * 检查消息是否已处理（去重）
 *
 * @param messageId 消息 ID
 * @returns 是否已处理过
 */
function isMessageProcessed(messageId: string): boolean {
  return processedMessageIds.has(messageId);
}

/**
 * 标记消息为已处理
 *
 * @param messageId 消息 ID
 */
function markMessageProcessed(messageId: string): void {
  // 如果缓存已满，先清理过期条目
  if (processedMessageIds.size >= DEDUP_CACHE_MAX_SIZE) {
    cleanupDedupCache();
    // 如果清理后仍然超过容量，删除最旧的条目
    if (processedMessageIds.size >= DEDUP_CACHE_MAX_SIZE) {
      const oldestId = processedMessageTimestamps.keys().next().value;
      if (oldestId) {
        processedMessageIds.delete(oldestId);
        processedMessageTimestamps.delete(oldestId);
      }
    }
  }
  processedMessageIds.add(messageId);
  processedMessageTimestamps.set(messageId, Date.now());
}

function touchDedupCache(now: number): void {
  if (processedMessageIds.size > 0) {
    cleanupDedupCache();
  }
  cleanupSignatureCache(now);
}

/**
 * 启动钉钉 Stream 连接监控
 * 
 * 使用 DWClient 建立 Stream 连接，注册 TOPIC_ROBOT 回调处理消息。
 * 支持 abortSignal 进行优雅关闭。
 * 
 * @param opts 监控配置选项
 * @returns Promise<void> 连接关闭时 resolve
 * @throws Error 如果凭证未配置
 * 
 * Requirements: 3.1, 3.3, 3.4, 3.5
 */
export async function monitorDingtalkProvider(opts: MonitorDingtalkOpts = {}): Promise<void> {
  const { config, runtime, abortSignal, accountId = "default" } = opts;
  
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;
  
  // Single-account: only one active connection allowed.
  if (currentClient) {
    if (currentAccountId && currentAccountId !== accountId) {
      throw new Error(`DingTalk already running for account ${currentAccountId}`);
    }
    log(`[dingtalk] existing connection for account ${accountId} is active, reusing monitor`);
    if (currentPromise) {
      return currentPromise;
    }
    throw new Error("DingTalk monitor state invalid: active client without promise");
  }

  // Get DingTalk config.
  const dingtalkCfg = config?.channels?.dingtalk;
  if (!dingtalkCfg) {
    throw new Error("DingTalk configuration not found");
  }

  // Create Stream client.
  let client: DWClient;
  try {
    client = createDingtalkClientFromConfig(dingtalkCfg);
  } catch (err) {
    error(`[dingtalk] failed to create client: ${String(err)}`);
    throw err;
  }

  currentClient = client;
  currentAccountId = accountId;

  log(`[dingtalk] starting Stream connection for account ${accountId}...`);

  currentPromise = new Promise<void>((resolve, reject) => {
    let stopped = false;

    // Cleanup state and disconnect the client.
    const cleanup = () => {
      if (currentClient === client) {
        currentClient = null;
        currentAccountId = null;
        currentStop = null;
        currentPromise = null;
      }
      try {
        client.disconnect();
      } catch (err) {
        error(`[dingtalk] failed to disconnect client: ${String(err)}`);
      }
    };

    const finalizeResolve = () => {
      if (stopped) return;
      stopped = true;
      abortSignal?.removeEventListener("abort", handleAbort);
      cleanup();
      resolve();
    };

    const finalizeReject = (err: unknown) => {
      if (stopped) return;
      stopped = true;
      abortSignal?.removeEventListener("abort", handleAbort);
      cleanup();
      reject(err);
    };

    // Handle abort signal.
    const handleAbort = () => {
      log("[dingtalk] abort signal received, stopping Stream client");
      finalizeResolve();
    };

    // Expose a stop hook for manual shutdown.
    currentStop = () => {
      log("[dingtalk] stop requested, stopping Stream client");
      finalizeResolve();
    };

    // If already aborted, resolve immediately.
    if (abortSignal?.aborted) {
      finalizeResolve();
      return;
    }

    // Register abort handler.
    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    try {
      // Register TOPIC_ROBOT callback.
      client.registerCallbackListener(TOPIC_ROBOT, (res) => {
        try {
          // Parse message payload.
          const rawMessage = JSON.parse(res.data) as DingtalkRawMessage;
          if (res?.headers?.messageId) {
            rawMessage.streamMessageId = res.headers.messageId;
          }

          const content =
            (rawMessage.msgtype === "text" ? rawMessage.text?.content : undefined) ??
            rawMessage.content?.recognition ??
            "";
          const contentTrimmed = content.trim();
          const contentLen = contentTrimmed.length;
          const contentHash = hashText(`${rawMessage.msgtype}:${contentTrimmed}`);

          log(
            `[dingtalk] inbound message: streamId=${rawMessage.streamMessageId ?? "none"} sender=${rawMessage.senderId} convo=${rawMessage.conversationId} type=${rawMessage.msgtype} len=${contentLen} hash=${contentHash}`,
          );

          const now = Date.now();
          touchDedupCache(now);

          // Build dedupe key (prefer Stream message id).
          const dedupeId = rawMessage.streamMessageId
            ? `${accountId}:${rawMessage.streamMessageId}`
            : `${accountId}:${rawMessage.conversationId}_${rawMessage.senderId}_${rawMessage.text?.content?.slice(0, 50) ?? rawMessage.msgtype}`;

          log(`[dingtalk] dedupe key: ${dedupeId.slice(0, 80)}`);

          // Skip if already processed.
          if (isMessageProcessed(dedupeId)) {
            log(
              `[dingtalk] duplicate message detected, skipping (id=${dedupeId.slice(0, 80)}, streamId=${rawMessage.streamMessageId ?? "none"}, hash=${contentHash})`,
            );
            return EventAck.SUCCESS;
          }

          const signature = `${accountId}:${rawMessage.conversationId}:${rawMessage.senderId}:${contentHash}`;
          if (isSignatureDuplicate(signature, now)) {
            log(
              `[dingtalk] duplicate signature detected, skipping (signature=${signature.slice(0, 100)}, ttlMs=${SIGNATURE_TTL_MS})`,
            );
            return EventAck.SUCCESS;
          }

          // Mark before processing to prevent concurrent duplicates.
          markMessageProcessed(dedupeId);

          log(`[dingtalk] received message from ${rawMessage.senderId} (type=${rawMessage.msgtype})`);

          // Process asynchronously; ACK immediately.
          void handleDingtalkMessage({
            cfg: config,
            raw: rawMessage,
            accountId,
            log,
            error,
          }).catch((err) => {
            error(`[dingtalk] error handling message: ${String(err)}`);
          });

          return EventAck.SUCCESS;
        } catch (err) {
          error(`[dingtalk] error handling message: ${String(err)}`);
          return EventAck.SUCCESS;
        }
      });

      // Start Stream connection.
      client.connect();

      log("[dingtalk] Stream client connected");
    } catch (err) {
      error(`[dingtalk] failed to start Stream connection: ${String(err)}`);
      finalizeReject(err);
    }
  });

  return currentPromise;
}

/**
 * 停止钉钉 Monitor
 */
export function stopDingtalkMonitor(): void {
  if (currentStop) {
    currentStop();
    return;
  }
  if (currentClient) {
    try {
      currentClient.disconnect();
    } catch (err) {
      console.error(`[dingtalk] failed to disconnect client: ${String(err)}`);
    } finally {
      currentClient = null;
      currentAccountId = null;
      currentPromise = null;
      currentStop = null;
    }
  }
}

/**
 * 获取当前 Stream 客户端状态
 * 
 * 用于诊断和测试
 * 
 * @returns 是否有活跃的客户端连接
 */
export function isMonitorActive(): boolean {
  return currentClient !== null;
}

/**
 * 获取当前活跃连接的账户 ID
 * 
 * 用于诊断和测试
 * 
 * @returns 当前账户 ID 或 null
 */
export function getCurrentAccountId(): string | null {
  return currentAccountId;
}

/**
 * 清除消息去重缓存
 * 
 * 用于测试或需要重置去重状态的场景
 */
export function clearDedupCache(): void {
  processedMessageIds.clear();
  processedMessageTimestamps.clear();
  recentSignatureTimestamps.clear();
}
