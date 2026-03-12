/**
 * QQ Bot 入站消息处理
 */

import {
  checkDmPolicy,
  checkGroupPolicy,
  cleanupFileSafe,
  createLogger,
  downloadToTempFile,
  type ExtractedMedia,
  finalizeInboundMediaFile,
  fetchMediaFromUrl,
  type Logger,
  appendCronHiddenPrompt,
  ASRError,
  detectMediaType,
  extractMediaFromText,
  isImagePath,
  isLocalReference,
  pruneInboundMediaDir,
  stripTitleFromUrl,
  transcribeTencentFlash,
} from "@openclaw-china/shared";
import {
  resolveQQBotASRCredentials,
  resolveInboundMediaDir,
  resolveInboundMediaKeepDays,
  resolveInboundMediaTempDir,
  resolveQQBotAutoSendLocalPathMedia,
  mergeQQBotAccountConfig,
  DEFAULT_ACCOUNT_ID,
  type QQBotC2CMarkdownDeliveryMode,
  type QQBotAccountConfig,
  type PluginConfig,
} from "./config.js";
import {
  isQQBotHttpImageUrl,
  normalizeQQBotMarkdownImages,
} from "./markdown-images.js";
import { qqbotOutbound } from "./outbound.js";
import { upsertKnownQQBotTarget, type KnownQQBotTarget } from "./proactive.js";
import { getQQBotRuntime } from "./runtime.js";
import type {
  InboundContext,
  QQInboundAttachment,
  QQInboundMessage,
} from "./types.js";
import * as fs from "node:fs";

type DispatchParams = {
  eventType: string;
  eventData: unknown;
  eventId?: string;
  cfg?: PluginConfig;
  accountId: string;
  logger?: Logger;
};

type QQBotAgentRoute = {
  sessionKey: string;
  accountId: string;
  agentId?: string;
  mainSessionKey?: string;
  effectiveSessionKey?: string;
};

const sessionDispatchQueue = new Map<string, Promise<void>>();

function resolveQQBotRouteSessionKey(route: QQBotAgentRoute): string {
  const effectiveSessionKey = route.effectiveSessionKey?.trim();
  if (effectiveSessionKey) {
    return effectiveSessionKey;
  }
  return route.sessionKey;
}

function buildSessionDispatchQueueKey(route: QQBotAgentRoute): string {
  const accountId = route.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  return `${accountId}:${resolveQQBotRouteSessionKey(route)}`;
}

async function runSerializedSessionDispatch<T>(
  queueKey: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = sessionDispatchQueue.get(queueKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const cleanup = run.then(() => undefined, () => undefined);
  sessionDispatchQueue.set(queueKey, cleanup);

  try {
    return await run;
  } finally {
    if (sessionDispatchQueue.get(queueKey) === cleanup) {
      sessionDispatchQueue.delete(queueKey);
    }
  }
}

function toString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

function normalizeAttachmentUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}

function parseAttachments(payload: Record<string, unknown>): QQInboundAttachment[] {
  const raw = payload.attachments;
  if (!Array.isArray(raw)) return [];

  const items: QQInboundAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const data = entry as Record<string, unknown>;
    const url = normalizeAttachmentUrl(data.url);
    if (!url) continue;
    items.push({
      url,
      filename: toString(data.filename),
      contentType: toString(data.content_type),
      size: toNonNegativeNumber(data.size),
    });
  }
  return items;
}

function parseTextWithAttachments(payload: Record<string, unknown>): {
  text: string;
  attachments: QQInboundAttachment[];
} {
  const rawContent = typeof payload.content === "string" ? payload.content : "";
  const attachments = parseAttachments(payload);
  return {
    text: rawContent.trim(),
    attachments,
  };
}

function resolveEventId(payload: Record<string, unknown>, fallbackEventId?: string): string | undefined {
  return toString(payload.event_id) ?? toString(payload.eventId) ?? toString(fallbackEventId);
}

type ResolvedInboundAttachment = {
  attachment: QQInboundAttachment;
  localImagePath?: string;
  voiceTranscript?: string;
};

type ResolvedInboundAttachmentResult = {
  attachments: ResolvedInboundAttachment[];
  hasVoiceAttachment: boolean;
  hasVoiceTranscript: boolean;
  asrErrorMessage?: string;
};

const VOICE_ASR_FALLBACK_TEXT = "当前语音功能未启动或识别失败，请稍后重试。";
const VOICE_EXTENSIONS = [".silk", ".amr", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".speex"];
const VOICE_ASR_ERROR_MAX_LENGTH = 500;
export const LONG_TASK_NOTICE_TEXT = "任务处理时间较长，请稍等，我还在继续处理。";
export const DEFAULT_LONG_TASK_NOTICE_DELAY_MS = 30000;
const QQ_GROUP_NO_REPLY_FALLBACK_TEXT = "我在。你可以直接说具体一点。";

type LongTaskNoticeController = {
  markReplyDelivered: () => void;
  dispose: () => void;
};

export function startLongTaskNoticeTimer(params: {
  delayMs: number;
  logger: Pick<Logger, "warn">;
  sendNotice: () => Promise<void>;
}): LongTaskNoticeController {
  const { delayMs, logger, sendNotice } = params;
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  if (delayMs > 0) {
    timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      timer = null;
      void sendNotice().catch((err) => {
        logger.warn(`send long-task notice failed: ${String(err)}`);
      });
    }, delayMs);
    timer.unref?.();
  } else {
    completed = true;
  }

  return {
    markReplyDelivered: () => {
      if (completed) return;
      completed = true;
      clear();
    },
    dispose: () => {
      completed = true;
      clear();
    },
  };
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isImageAttachment(att: QQInboundAttachment): boolean {
  const contentType = att.contentType?.trim().toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    return true;
  }

  if (att.filename && isImagePath(att.filename)) {
    return true;
  }

  try {
    return isImagePath(new URL(att.url).pathname);
  } catch {
    return false;
  }
}

function isVoiceAttachment(att: QQInboundAttachment): boolean {
  const contentType = att.contentType?.trim().toLowerCase() ?? "";
  if (contentType === "voice" || contentType.startsWith("audio/")) {
    return true;
  }

  const lowerName = att.filename?.trim().toLowerCase() ?? "";
  if (VOICE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return true;
  }

  try {
    const pathname = new URL(att.url).pathname.toLowerCase();
    return VOICE_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function scheduleTempCleanup(filePath: string): void {
  const timer = setTimeout(() => {
    void cleanupFileSafe(filePath);
  }, 20 * 60 * 1000);
  timer.unref?.();
}

function trimTextForReply(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function buildVoiceASRFallbackReply(errorMessage?: string): string {
  const detail = errorMessage?.trim();
  if (!detail) return VOICE_ASR_FALLBACK_TEXT;
  return `${VOICE_ASR_FALLBACK_TEXT}\n\n接口错误：${trimTextForReply(detail, VOICE_ASR_ERROR_MAX_LENGTH)}`;
}

async function resolveInboundAttachmentsForAgent(params: {
  attachments?: QQInboundAttachment[];
  qqCfg: QQBotAccountConfig;
  logger: Logger;
}): Promise<ResolvedInboundAttachmentResult> {
  const { attachments, qqCfg, logger } = params;
  const list = attachments ?? [];
  if (list.length === 0) {
    return {
      attachments: [],
      hasVoiceAttachment: false,
      hasVoiceTranscript: false,
      asrErrorMessage: undefined,
    };
  }

  const timeout = qqCfg.mediaTimeoutMs ?? 30000;
  const maxFileSizeMB = qqCfg.maxFileSizeMB ?? 100;
  const maxSize = Math.floor(maxFileSizeMB * 1024 * 1024);
  const asrCredentials = resolveQQBotASRCredentials(qqCfg);
  const inboundMediaDir = resolveInboundMediaDir(qqCfg);
  const inboundMediaTempDir = resolveInboundMediaTempDir();

  const resolved: ResolvedInboundAttachment[] = [];
  let hasVoiceAttachment = false;
  let hasVoiceTranscript = false;
  let asrErrorMessage: string | undefined;

  for (const att of list) {
    const next: ResolvedInboundAttachment = { attachment: att };
    if (isImageAttachment(att) && isHttpUrl(att.url)) {
      try {
        const downloaded = await downloadToTempFile(att.url, {
          timeout,
          maxSize,
          sourceFileName: att.filename,
          tempPrefix: "qqbot-inbound",
          tempDir: inboundMediaTempDir,
        });
        const finalPath = await finalizeInboundMediaFile({
          filePath: downloaded.path,
          tempDir: inboundMediaTempDir,
          inboundDir: inboundMediaDir,
        });
        next.localImagePath = finalPath;
        logger.info(`inbound image cached: ${finalPath}`);
        if (finalPath === downloaded.path) {
          scheduleTempCleanup(downloaded.path);
        }
      } catch (err) {
        logger.warn(`failed to download inbound attachment: ${String(err)}`);
      }
    }

    if (isVoiceAttachment(att)) {
      hasVoiceAttachment = true;
      if (!qqCfg.asr?.enabled) {
        logger.info("voice attachment received but ASR is disabled");
      } else if (!asrCredentials) {
        logger.warn("voice ASR enabled but credentials are missing or invalid");
      } else if (!isHttpUrl(att.url)) {
        logger.warn("voice ASR skipped: attachment URL is not an HTTP URL");
      } else {
        try {
          const media = await fetchMediaFromUrl(att.url, {
            timeout,
            maxSize,
          });
          const transcript = await transcribeTencentFlash({
            audio: media.buffer,
            config: {
              appId: asrCredentials.appId,
              secretId: asrCredentials.secretId,
              secretKey: asrCredentials.secretKey,
              timeoutMs: timeout,
            },
          });
          if (transcript.trim()) {
            next.voiceTranscript = transcript.trim();
            hasVoiceTranscript = true;
            logger.info(
              `[voice-asr] transcript: ${next.voiceTranscript}${att.filename ? ` (file: ${att.filename})` : ""}`
            );
          }
        } catch (err) {
          if (err instanceof ASRError) {
            logger.warn(
              `voice ASR failed: kind=${err.kind} provider=${err.provider} retryable=${err.retryable} message=${err.message}`
            );
            asrErrorMessage ??= err.message.trim() || undefined;
          } else {
            logger.warn(`voice ASR failed: ${String(err)}`);
          }
        }
      }
    }
    resolved.push(next);
  }
  return {
    attachments: resolved,
    hasVoiceAttachment,
    hasVoiceTranscript,
    asrErrorMessage,
  };
}

function buildInboundContentWithAttachments(params: {
  content: string;
  attachments?: ResolvedInboundAttachment[];
}): string {
  const { content, attachments } = params;
  const list = attachments ?? [];
  if (list.length === 0) return content;

  const imageRefs = list
    .map((item) => item.localImagePath)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => `[Image: source: ${value}]`);

  const voiceTranscripts = list
    .filter((item) => typeof item.voiceTranscript === "string" && item.voiceTranscript.trim())
    .map((item, index) => {
      const filename = item.attachment.filename?.trim() || `voice-${index + 1}`;
      return `- ${filename}: ${item.voiceTranscript as string}`;
    });

  const lines = list.map((item, index) => {
    const att = item.attachment;
    const filename = att.filename?.trim() ? att.filename.trim() : `attachment-${index + 1}`;
    const meta = [att.contentType, typeof att.size === "number" ? `${att.size} bytes` : undefined]
      .filter((v): v is string => Boolean(v))
      .join(", ");
    const tail = item.localImagePath ? "[local image attached]" : att.url;
    return meta ? `- ${filename} (${meta}): ${tail}` : `- ${filename}: ${tail}`;
  });
  const block = ["[QQ attachments]", ...lines].join("\n");

  const parts: string[] = [];
  if (content) parts.push(content);
  if (imageRefs.length > 0) parts.push(imageRefs.join("\n"));
  if (voiceTranscripts.length > 0) {
    parts.push(["[QQ voice transcripts]", ...voiceTranscripts].join("\n"));
  }
  parts.push(block);
  return parts.join("\n\n");
}

function resolveInboundLogContent(params: {
  content: string;
  attachments?: QQInboundAttachment[];
}): string {
  const text = params.content.trim();
  if (text) return text;

  const attachments = params.attachments ?? [];
  if (attachments.some((att) => isVoiceAttachment(att))) {
    return "【语音】";
  }
  if (attachments.some((att) => isImageAttachment(att))) {
    return "【图片】";
  }
  if (attachments.length > 0) {
    return "【附件】";
  }
  return "【空消息】";
}

function sanitizeInboundLogText(text: string): string {
  return text.replace(/\r?\n/g, "\\n");
}

function parseC2CMessage(data: unknown, fallbackEventId?: string): QQInboundMessage | null {
  const payload = data as Record<string, unknown>;
  const { text, attachments } = parseTextWithAttachments(payload);
  const id = toString(payload.id);
  const eventId = resolveEventId(payload, fallbackEventId);
  const timestamp = toNumber(payload.timestamp) ?? Date.now();
  const author = (payload.author ?? {}) as Record<string, unknown>;
  const senderId = toString(author.user_openid);
  if ((!text && attachments.length === 0) || !id || !senderId) return null;

  return {
    type: "direct",
    senderId,
    c2cOpenid: senderId,
    senderName: toString(author.username),
    content: text,
    attachments: attachments.length > 0 ? attachments : undefined,
    messageId: id,
    eventId,
    timestamp,
    mentionedBot: false,
  };
}

function parseGroupMessage(data: unknown, fallbackEventId?: string): QQInboundMessage | null {
  const payload = data as Record<string, unknown>;
  const { text, attachments } = parseTextWithAttachments(payload);
  const id = toString(payload.id);
  const eventId = resolveEventId(payload, fallbackEventId);
  const timestamp = toNumber(payload.timestamp) ?? Date.now();
  const groupOpenid = toString(payload.group_openid);
  const author = (payload.author ?? {}) as Record<string, unknown>;
  const senderId = toString(author.member_openid);
  if ((!text && attachments.length === 0) || !id || !senderId || !groupOpenid) return null;

  return {
    type: "group",
    senderId,
    senderName: toString(author.nickname) ?? toString(author.username),
    content: text,
    attachments: attachments.length > 0 ? attachments : undefined,
    messageId: id,
    eventId,
    timestamp,
    groupOpenid,
    mentionedBot: true,
  };
}

function parseChannelMessage(data: unknown, fallbackEventId?: string): QQInboundMessage | null {
  const payload = data as Record<string, unknown>;
  const { text, attachments } = parseTextWithAttachments(payload);
  const id = toString(payload.id);
  const eventId = resolveEventId(payload, fallbackEventId);
  const timestamp = toNumber(payload.timestamp) ?? Date.now();
  const channelId = toString(payload.channel_id);
  const guildId = toString(payload.guild_id);
  const author = (payload.author ?? {}) as Record<string, unknown>;
  const senderId = toString(author.id);
  if ((!text && attachments.length === 0) || !id || !senderId || !channelId) return null;

  return {
    type: "channel",
    senderId,
    senderName: toString(author.username),
    content: text,
    attachments: attachments.length > 0 ? attachments : undefined,
    messageId: id,
    eventId,
    timestamp,
    channelId,
    guildId,
    mentionedBot: true,
  };
}

function parseDirectMessage(data: unknown, fallbackEventId?: string): QQInboundMessage | null {
  const payload = data as Record<string, unknown>;
  const { text, attachments } = parseTextWithAttachments(payload);
  const id = toString(payload.id);
  const eventId = resolveEventId(payload, fallbackEventId);
  const timestamp = toNumber(payload.timestamp) ?? Date.now();
  const guildId = toString(payload.guild_id);
  const author = (payload.author ?? {}) as Record<string, unknown>;
  const senderId = toString(author.id);
  if ((!text && attachments.length === 0) || !id || !senderId) return null;

  return {
    type: "direct",
    senderId,
    senderName: toString(author.username),
    content: text,
    attachments: attachments.length > 0 ? attachments : undefined,
    messageId: id,
    eventId,
    timestamp,
    guildId,
    mentionedBot: false,
  };
}

function resolveInbound(eventType: string, data: unknown, fallbackEventId?: string): QQInboundMessage | null {
  switch (eventType) {
    case "C2C_MESSAGE_CREATE":
      return parseC2CMessage(data, fallbackEventId);
    case "GROUP_AT_MESSAGE_CREATE":
      return parseGroupMessage(data, fallbackEventId);
    case "AT_MESSAGE_CREATE":
      return parseChannelMessage(data, fallbackEventId);
    case "DIRECT_MESSAGE_CREATE":
      return parseDirectMessage(data, fallbackEventId);
    default:
      return null;
  }
}

function resolveChatTarget(event: QQInboundMessage): { to: string; peerId: string; peerKind: "group" | "dm" } {
  if (event.type === "group") {
    const group = event.groupOpenid ?? "";
    const normalizedGroup = group.toLowerCase();
    return {
      to: `group:${group}`,
      peerId: `group:${normalizedGroup}`,
      peerKind: "group",
    };
  }
  if (event.type === "channel") {
    const channel = event.channelId ?? "";
    const normalizedChannel = channel.toLowerCase();
    return {
      to: `channel:${channel}`,
      peerId: `channel:${normalizedChannel}`,
      peerKind: "group",
    };
  }
  return {
    to: `user:${event.senderId}`,
    peerId: event.senderId,
    peerKind: "dm",
  };
}

function resolveQQBotEffectiveSessionKey(params: {
  inbound: QQInboundMessage;
  route: QQBotAgentRoute;
  accountId: string;
}): string {
  const { inbound, route, accountId } = params;
  if (inbound.type !== "direct") {
    return route.sessionKey;
  }

  const senderStableId = inbound.c2cOpenid?.trim() || inbound.senderId?.trim();
  if (!senderStableId) {
    return route.sessionKey;
  }

  const resolvedAccountId = route.accountId?.trim() || accountId.trim() || DEFAULT_ACCOUNT_ID;
  return `qqbot:dm:${resolvedAccountId}:${senderStableId}`;
}

function resolveEnvelopeFrom(event: QQInboundMessage): string {
  if (event.type === "group") {
    return `group:${(event.groupOpenid ?? "unknown").toLowerCase()}`;
  }
  if (event.type === "channel") {
    return `channel:${(event.channelId ?? "unknown").toLowerCase()}`;
  }
  return event.senderName?.trim() || event.senderId;
}

export function resolveKnownQQBotTargetFromInbound(params: {
  inbound: QQInboundMessage;
  accountId: string;
}): KnownQQBotTarget | undefined {
  const { inbound, accountId } = params;

  if (inbound.type === "direct") {
    if (!inbound.c2cOpenid?.trim()) {
      return undefined;
    }
    return {
      accountId,
      kind: "user",
      target: `user:${inbound.c2cOpenid}`,
      displayName: inbound.senderName,
      sourceChatType: "direct",
      firstSeenAt: inbound.timestamp,
      lastSeenAt: inbound.timestamp,
    };
  }

  if (inbound.type === "group" && inbound.groupOpenid?.trim()) {
    return {
      accountId,
      kind: "group",
      target: `group:${inbound.groupOpenid}`,
      displayName: inbound.senderName,
      sourceChatType: "group",
      firstSeenAt: inbound.timestamp,
      lastSeenAt: inbound.timestamp,
    };
  }

  if (inbound.type === "channel" && inbound.channelId?.trim()) {
    return {
      accountId,
      kind: "channel",
      target: `channel:${inbound.channelId}`,
      displayName: inbound.senderName,
      sourceChatType: "channel",
      firstSeenAt: inbound.timestamp,
      lastSeenAt: inbound.timestamp,
    };
  }

  return undefined;
}

function extractLocalMediaFromText(params: {
  text: string;
  logger?: Logger;
}): { text: string; mediaUrls: string[] } {
  const { text, logger } = params;
  const mediaUrls: string[] = [];
  const seenMedia = new Set<string>();
  let nextText = text;
  const MARKDOWN_LINKED_IMAGE_RE = /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g;
  const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
  const BARE_LOCAL_MEDIA_PATH_RE =
    /`?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s`'",)]+|[A-Za-z]:[\\/][^\s`'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp|svg|ico|mp3|wav|ogg|m4a|amr|flac|aac|wma|mp4|mov|avi|mkv|webm|flv|wmv|m4v))`?/gi;

  const collectLocalRichMedia = (
    rawValue: string,
    allowedTypes?: ReadonlySet<"image" | "audio" | "video">
  ): string | undefined => {
    const candidate = stripTitleFromUrl(rawValue.trim());
    if (!candidate || !isLocalReference(candidate)) {
      return undefined;
    }
    if (!fs.existsSync(candidate)) {
      logger?.warn?.(`[media] local file not found: ${candidate}`);
      return undefined;
    }
    const mediaType = detectMediaType(candidate);
    if (mediaType === "file") {
      return undefined;
    }
    if (allowedTypes && !allowedTypes.has(mediaType)) {
      return undefined;
    }
    if (seenMedia.has(candidate)) {
      return candidate;
    }
    seenMedia.add(candidate);
    mediaUrls.push(candidate);
    return candidate;
  };

  nextText = nextText.replace(MARKDOWN_LINKED_IMAGE_RE, (fullMatch, _alt, rawPath) => {
    return collectLocalRichMedia(rawPath) ? "" : fullMatch;
  });

  nextText = nextText.replace(MARKDOWN_IMAGE_RE, (fullMatch, _alt, rawPath) => {
    return collectLocalRichMedia(rawPath) ? "" : fullMatch;
  });

  nextText = nextText.replace(MARKDOWN_LINK_RE, (fullMatch, _label, rawPath) => {
    const mediaPath = collectLocalRichMedia(rawPath, new Set(["audio", "video"]));
    if (!mediaPath) {
      return fullMatch;
    }
    return "";
  });

  nextText = nextText.replace(BARE_LOCAL_MEDIA_PATH_RE, (fullMatch, rawPath) => {
    return collectLocalRichMedia(rawPath) ? "" : fullMatch;
  });

  nextText = nextText.replace(/[ \t]+\n/g, "\n");
  nextText = nextText.replace(/\n{3,}/g, "\n\n");

  return {
    text: nextText.trim(),
    mediaUrls,
  };
}

function extractMediaLinesFromText(params: {
  text: string;
  logger?: Logger;
}): { text: string; mediaUrls: string[] } {
  const { text, logger } = params;
  const result = extractMediaFromText(text, {
    removeFromText: true,
    checkExists: true,
    existsSync: (p: string) => {
      const exists = fs.existsSync(p);
      if (!exists) {
        logger?.warn?.(`[media] local file not found: ${p}`);
      }
      return exists;
    },
    parseMediaLines: true,
    parseMarkdownImages: false,
    parseHtmlImages: false,
    parseBarePaths: false,
    parseMarkdownLinks: false,
  });

  const mediaUrls = result.all
    .map((m) => (m.isLocal ? m.localPath ?? m.source : m.source))
    .filter((m): m is string => typeof m === "string" && m.trim().length > 0);

  return { text: result.text, mediaUrls };
}

export function extractQQBotReplyMedia(params: {
  text: string;
  logger?: Logger;
  autoSendLocalPathMedia?: boolean;
}): { text: string; mediaUrls: string[] } {
  const mediaLineResult = extractMediaLinesFromText({
    text: params.text,
    logger: params.logger,
  });
  if (!params.autoSendLocalPathMedia) {
    return mediaLineResult;
  }

  const localMediaResult = extractLocalMediaFromText({
    text: mediaLineResult.text,
    logger: params.logger,
  });

  return {
    text: localMediaResult.text,
    mediaUrls: [...new Set([...mediaLineResult.mediaUrls, ...localMediaResult.mediaUrls])],
  };
}

function buildMediaFallbackText(mediaUrl: string): string | undefined {
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return undefined;
  }
  return `📎 ${mediaUrl}`;
}

const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const FINAL_BLOCK_RE = /<final\b[^>]*>([\s\S]*?)<\/final>/gi;
const RAW_THINK_OR_FINAL_TAG_RE = /<\/?(?:think|final)\b[^>]*>/gi;
const FILE_PLACEHOLDER_RE = /\[文件:\s*[^\]\n]+\]/g;
const DIRECTIVE_TAG_RE =
  /\[\[\s*(?:reply_to_current|reply_to\s*:[^\]]+|audio_as_voice|tts(?::text)?|\/tts(?::text)?)\s*\]\]/gi;
const VOICE_EMOTION_TAG_RE =
  /\[(?:happy|excited|calm|sad|angry|frustrated|softly|whispers|loudly|cheerfully|deadpan|sarcastically|laughs|sighs|chuckles|gasps|pause|slowly|rushed|hesitates|playfully|warmly|gently)\]/gi;
const TTS_LIKE_RAW_TEXT_RE =
  /\[\[\s*(?:tts(?::text)?|\/tts(?::text)?|audio_as_voice|reply_to_current|reply_to\s*:)/i;
const MARKDOWN_TABLE_SEPARATOR_RE = /^\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?)?\|?$/;
const EXPLICIT_MARKDOWN_FENCE_RE = /(^|\n)(`{3,}|~{3,})\s*(?:markdown|md)\s*\n([\s\S]*?)\n\2(?=\n|$)/gi;
const GENERIC_MARKDOWN_FENCE_RE = /(^|\n)(`{3,}|~{3,})\s*\n([\s\S]*?)\n\2(?=\n|$)/g;

function extractFinalBlocks(text: string): string | undefined {
  const matches = Array.from(text.matchAll(FINAL_BLOCK_RE));
  if (matches.length === 0) return undefined;
  return matches.map((match) => (match[1] ?? "").trim()).filter(Boolean).join("\n");
}

export function sanitizeQQBotOutboundText(rawText: string): string {
  if (!rawText) return "";
  let next = rawText.replace(/\r\n/g, "\n");

  const finalOnly = extractFinalBlocks(next);
  if (typeof finalOnly === "string") {
    next = finalOnly;
  }

  next = next.replace(THINK_BLOCK_RE, "");
  next = next.replace(RAW_THINK_OR_FINAL_TAG_RE, "");
  next = next.replace(FILE_PLACEHOLDER_RE, " ");
  next = next.replace(DIRECTIVE_TAG_RE, " ");
  next = next.replace(VOICE_EMOTION_TAG_RE, " ");
  next = next.replace(/[ \t]+\n/g, "\n");
  next = next.replace(/\n{3,}/g, "\n\n");
  next = next.trim();

  if (!next) return "";
  if (/^NO_REPLY$/i.test(next)) return "";
  return next;
}

function formatQQBotOutboundPreview(text: string, maxLength = 240): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return '""';
  }
  const preview =
    normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3))}...` : normalized;
  return JSON.stringify(preview);
}

export function shouldSuppressQQBotTextWhenMediaPresent(rawText: string, sanitizedText: string): boolean {
  const raw = rawText.trim();
  if (!raw) return false;
  if (TTS_LIKE_RAW_TEXT_RE.test(raw)) return true;
  if (/<(?:think|final)\b/i.test(raw)) return true;
  if (!sanitizedText) return true;
  return !/[A-Za-z0-9\u4e00-\u9fff]/.test(sanitizedText);
}

export function resolveQQBotNoReplyFallback(params: {
  inbound: Pick<QQInboundMessage, "type" | "mentionedBot" | "content" | "attachments">;
  replyDelivered: boolean;
}): string | undefined {
  const { inbound, replyDelivered } = params;
  if (replyDelivered) return undefined;
  if (!inbound.mentionedBot) return undefined;
  if (inbound.type !== "group" && inbound.type !== "channel") return undefined;

  const hasVisibleInput = inbound.content.trim().length > 0 || (inbound.attachments?.length ?? 0) > 0;
  if (!hasVisibleInput) return undefined;

  return QQ_GROUP_NO_REPLY_FALLBACK_TEXT;
}

export function isQQBotGroupMessageInterfaceBlocked(errorMessage?: string): boolean {
  const text = (errorMessage ?? "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("304103") ||
    text.includes("群内消息接口被临时封禁") ||
    text.includes("机器人存在安全风险")
  );
}

export function evaluateReplyFinalOnlyDelivery(params: {
  replyFinalOnly: boolean;
  kind?: string;
  hasMedia: boolean;
  sanitizedText: string;
}): { skipDelivery: boolean; suppressText: boolean } {
  const { replyFinalOnly, kind, hasMedia } = params;
  if (!replyFinalOnly || !kind || kind === "final") {
    return { skipDelivery: false, suppressText: false };
  }
  if (hasMedia) {
    return { skipDelivery: false, suppressText: true };
  }
  return { skipDelivery: true, suppressText: false };
}

function isQQBotC2CTarget(to: string): boolean {
  const trimmed = to.trim();
  const raw = trimmed.startsWith("qqbot:") ? trimmed.slice("qqbot:".length) : trimmed;
  return !raw.startsWith("group:") && !raw.startsWith("channel:");
}

function splitQQBotMarkdownTransportMediaUrls(mediaUrls: string[]): {
  markdownImageUrls: string[];
  mediaQueue: string[];
} {
  const markdownImageUrls: string[] = [];
  const mediaQueue: string[] = [];
  const seenMarkdownImages = new Set<string>();
  const seenMedia = new Set<string>();

  for (const rawUrl of mediaUrls) {
    const next = rawUrl.trim();
    if (!next) continue;

    if (isQQBotHttpImageUrl(next)) {
      if (seenMarkdownImages.has(next)) continue;
      seenMarkdownImages.add(next);
      markdownImageUrls.push(next);
      continue;
    }

    if (seenMedia.has(next)) continue;
    seenMedia.add(next);
    mediaQueue.push(next);
  }

  return { markdownImageUrls, mediaQueue };
}

export function hasQQBotMarkdownTable(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? "";
    const separator = lines[index + 1]?.trim() ?? "";
    if (!header.includes("|") || !MARKDOWN_TABLE_SEPARATOR_RE.test(separator)) {
      continue;
    }

    const headerColumns = header.split("|").filter((column) => column.trim()).length;
    const separatorColumns = separator.split("|").filter((column) => column.trim()).length;
    if (headerColumns >= 2 && separatorColumns >= 2) {
      return true;
    }
  }
  return false;
}

export function resolveQQBotTextReplyRefs(params: {
  to: string;
  text: string;
  markdownSupport: boolean;
  c2cMarkdownDeliveryMode?: QQBotC2CMarkdownDeliveryMode;
  replyToId?: string;
  replyEventId?: string;
}): {
  forceProactive: boolean;
  replyToId?: string;
  replyEventId?: string;
} {
  const mode = params.c2cMarkdownDeliveryMode ?? "proactive-table-only";
  const forceProactive =
    params.markdownSupport &&
    isQQBotC2CTarget(params.to) &&
    (mode === "proactive-all" ||
      (mode === "proactive-table-only" && hasQQBotMarkdownTable(params.text)));

  if (!forceProactive) {
    return {
      forceProactive: false,
      replyToId: params.replyToId,
      replyEventId: params.replyEventId,
    };
  }

  return {
    forceProactive: true,
    replyToId: undefined,
    replyEventId: undefined,
  };
}

export function appendQQBotBufferedText(bufferedTexts: string[], nextText: string): string[] {
  const normalized = nextText.trim();
  if (!normalized) return bufferedTexts;
  if (bufferedTexts.length === 0) return [normalized];

  const currentCombined = bufferedTexts.join("\n\n");
  if (currentCombined === normalized || currentCombined.includes(normalized)) {
    return bufferedTexts;
  }
  if (normalized.includes(currentCombined)) {
    return [normalized];
  }

  const last = bufferedTexts[bufferedTexts.length - 1];
  if (last === normalized) {
    return bufferedTexts;
  }

  return [...bufferedTexts, normalized];
}

export function normalizeQQBotRenderedMarkdown(text: string): string {
  if (!text.trim()) return "";

  let next = text.trim();
  let changed = false;

  next = next.replace(
    EXPLICIT_MARKDOWN_FENCE_RE,
    (block, leadingLineBreak: string, _fence: string, inner: string) => {
      const normalizedInner = inner.trim();
      if (!normalizedInner) {
        return block;
      }
      changed = true;
      return `${leadingLineBreak}${normalizedInner}`;
    }
  );

  next = next.replace(
    GENERIC_MARKDOWN_FENCE_RE,
    (block, leadingLineBreak: string, _fence: string, inner: string) => {
      const normalizedInner = inner.trim();
      if (!normalizedInner) {
        return block;
      }
      if (!hasQQBotMarkdownTable(normalizedInner)) {
        return block;
      }
      changed = true;
      return `${leadingLineBreak}${normalizedInner}`;
    }
  );

  return changed ? next.trim() : text.trim();
}

export async function sendQQBotMediaWithFallback(params: {
  qqCfg: QQBotAccountConfig;
  to: string;
  mediaQueue: string[];
  replyToId?: string;
  replyEventId?: string;
  logger: Logger;
  onDelivered?: () => void;
  onError?: (error: string) => void;
  outbound?: Pick<typeof qqbotOutbound, "sendMedia" | "sendText">;
}): Promise<void> {
  const { qqCfg, to, mediaQueue, replyToId, replyEventId, logger, onDelivered, onError } = params;
  const outbound = params.outbound ?? qqbotOutbound;
  for (const mediaUrl of mediaQueue) {
    const result = await outbound.sendMedia({
      cfg: { channels: { qqbot: qqCfg } },
      to,
      mediaUrl,
      replyToId,
      replyEventId,
    });
    if (result.error) {
      logger.error(`sendMedia failed: ${result.error}`);
      onError?.(result.error);
      const fallback = buildMediaFallbackText(mediaUrl);
      if (!fallback) {
        continue;
      }
      const fallbackResult = await outbound.sendText({
        cfg: { channels: { qqbot: qqCfg } },
        to,
        text: fallback,
        replyToId,
        replyEventId,
      });
      if (fallbackResult.error) {
        logger.error(`sendText fallback failed: ${fallbackResult.error}`);
        onError?.(fallbackResult.error);
      } else {
        onDelivered?.();
      }
    } else {
      onDelivered?.();
    }
  }
}

function buildInboundContext(params: {
  event: QQInboundMessage;
  sessionKey: string;
  accountId: string;
  body?: string;
  rawBody?: string;
  commandBody?: string;
}): InboundContext {
  const { event, sessionKey, accountId } = params;
  const body = params.body ?? event.content;
  const rawBody = params.rawBody ?? event.content;
  const commandBody = params.commandBody ?? event.content;
  const chatType = event.type === "group" || event.type === "channel" ? "group" : "direct";
  const { to } = resolveChatTarget(event);
  const from =
    event.type === "group"
      ? `qqbot:group:${event.groupOpenid ?? ""}`
      : event.type === "channel"
        ? `qqbot:channel:${event.channelId ?? ""}`
        : `qqbot:${event.senderId}`;

  return {
    Body: body,
    RawBody: rawBody,
    CommandBody: commandBody,
    From: from,
    To: to,
    SessionKey: sessionKey,
    AccountId: accountId,
    ChatType: chatType,
    GroupSubject: event.type === "group" ? event.groupOpenid : event.channelId,
    SenderName: event.senderName,
    SenderId: event.senderId,
    Provider: "qqbot",
    MessageSid: event.messageId,
    Timestamp: event.timestamp,
    WasMentioned: event.mentionedBot,
    CommandAuthorized: true,
    OriginatingChannel: "qqbot",
    OriginatingTo: to,
  };
}

async function dispatchToAgent(params: {
  inbound: QQInboundMessage;
  cfg: unknown;
  qqCfg: QQBotAccountConfig;
  accountId: string;
  logger: Logger;
  route: QQBotAgentRoute;
}): Promise<void> {
  const { inbound, cfg, qqCfg, accountId, logger, route } = params;
  const runtime = getQQBotRuntime();
  const routeSessionKey = resolveQQBotRouteSessionKey(route);
  const target = resolveChatTarget(inbound);
  if (inbound.c2cOpenid) {
    const typing = await qqbotOutbound.sendTyping({
      cfg: { channels: { qqbot: qqCfg } },
      to: `user:${inbound.c2cOpenid}`,
      replyToId: inbound.messageId,
      replyEventId: inbound.eventId,
      inputSecond: 60,
    });
    if (typing.error) {
      logger.warn(`sendTyping failed: ${typing.error}`);
    }
  }

  const replyApi = runtime.channel?.reply;
  if (!replyApi) {
    logger.warn("reply API not available");
    return;
  }

  let replyDelivered = false;
  let groupMessageInterfaceBlocked = false;
  const markReplyDelivered = () => {
    replyDelivered = true;
    longTaskNotice.markReplyDelivered();
  };
  const markGroupMessageInterfaceBlocked = (error?: string) => {
    if (!isQQBotGroupMessageInterfaceBlocked(error)) return;
    if (!groupMessageInterfaceBlocked) {
      logger.warn("QQ group message interface is temporarily blocked by platform; suppressing extra sends");
    }
    groupMessageInterfaceBlocked = true;
  };

  const longTaskNotice = startLongTaskNoticeTimer({
    delayMs: qqCfg.longTaskNoticeDelayMs ?? DEFAULT_LONG_TASK_NOTICE_DELAY_MS,
    logger,
    sendNotice: async () => {
      if (groupMessageInterfaceBlocked) return;
      const result = await qqbotOutbound.sendText({
        cfg: { channels: { qqbot: qqCfg } },
        to: target.to,
        text: LONG_TASK_NOTICE_TEXT,
        replyToId: inbound.messageId,
        replyEventId: inbound.eventId,
      });
      if (result.error) {
        logger.warn(`send long-task notice failed: ${result.error}`);
        markGroupMessageInterfaceBlocked(result.error);
      } else {
        replyDelivered = true;
      }
    },
  });
  const inboundMediaDir = resolveInboundMediaDir(qqCfg);
  const inboundMediaKeepDays = resolveInboundMediaKeepDays(qqCfg);

  try {
    const sessionApi = runtime.channel?.session;
    const sessionConfig = (cfg as { session?: { store?: unknown } } | undefined)?.session;
    const storePath = sessionApi?.resolveStorePath?.(
      sessionConfig?.store,
      { agentId: route.agentId }
    );

    const envelopeOptions = replyApi.resolveEnvelopeFormatOptions?.(cfg);
    const previousTimestamp =
      storePath && sessionApi?.readSessionUpdatedAt
        ? sessionApi.readSessionUpdatedAt({ storePath, sessionKey: routeSessionKey })
        : null;
    const resolvedAttachmentResult = await resolveInboundAttachmentsForAgent({
      attachments: inbound.attachments,
      qqCfg,
      logger,
    });
    if (
      qqCfg.asr?.enabled &&
      resolvedAttachmentResult.hasVoiceAttachment &&
      !resolvedAttachmentResult.hasVoiceTranscript
    ) {
      const fallback = await qqbotOutbound.sendText({
        cfg: { channels: { qqbot: qqCfg } },
        to: target.to,
        text: buildVoiceASRFallbackReply(resolvedAttachmentResult.asrErrorMessage),
        replyToId: inbound.messageId,
        replyEventId: inbound.eventId,
      });
      if (fallback.error) {
        logger.error(`sendText ASR fallback failed: ${fallback.error}`);
        markGroupMessageInterfaceBlocked(fallback.error);
      } else {
        replyDelivered = true;
      }
      return;
    }
    const resolvedAttachments = resolvedAttachmentResult.attachments;
    const localImageCount = resolvedAttachments.filter((item) => Boolean(item.localImagePath)).length;
    if (localImageCount > 0) {
      logger.info(`prepared ${localImageCount} local image attachment(s) for agent`);
    }
    const rawBody = buildInboundContentWithAttachments({
      content: inbound.content,
      attachments: resolvedAttachments,
    });
    const envelopeFrom = resolveEnvelopeFrom(inbound);
    const inboundBody =
      replyApi.formatInboundEnvelope
        ? replyApi.formatInboundEnvelope({
            channel: "QQ",
            from: envelopeFrom,
            body: rawBody,
            timestamp: inbound.timestamp,
            previousTimestamp: previousTimestamp ?? undefined,
            chatType: inbound.type === "direct" ? "direct" : "group",
            senderLabel: inbound.senderName ?? inbound.senderId,
            sender: { id: inbound.senderId, name: inbound.senderName ?? undefined },
            envelope: envelopeOptions,
          })
        : replyApi.formatAgentEnvelope
          ? replyApi.formatAgentEnvelope({
              channel: "QQ",
              from: envelopeFrom,
              timestamp: inbound.timestamp,
              previousTimestamp: previousTimestamp ?? undefined,
              envelope: envelopeOptions,
              body: rawBody,
            })
          : rawBody;

    const inboundCtx = buildInboundContext({
      event: inbound,
      sessionKey: routeSessionKey,
      accountId: route.accountId ?? accountId,
      body: inboundBody,
      rawBody,
      commandBody: rawBody,
    });

    const finalizeInboundContext = replyApi?.finalizeInboundContext as
      | ((ctx: InboundContext) => InboundContext)
      | undefined;
    const finalCtx = finalizeInboundContext ? finalizeInboundContext(inboundCtx) : inboundCtx;

    let cronBase = "";
    if (typeof finalCtx.RawBody === "string" && finalCtx.RawBody) {
      cronBase = finalCtx.RawBody;
    } else if (typeof finalCtx.Body === "string" && finalCtx.Body) {
      cronBase = finalCtx.Body;
    } else if (typeof finalCtx.CommandBody === "string" && finalCtx.CommandBody) {
      cronBase = finalCtx.CommandBody;
    }

    if (cronBase) {
      const nextCron = appendCronHiddenPrompt(cronBase);
      if (nextCron !== cronBase) {
        finalCtx.BodyForAgent = nextCron;
      }
    }

    if (storePath && sessionApi?.recordInboundSession) {
      try {
        const isGroup = inbound.type === "group" || inbound.type === "channel";
        const updateLastRoute =
          !isGroup
            ? {
                sessionKey: routeSessionKey,
                channel: "qqbot",
                to: (finalCtx.OriginatingTo ?? finalCtx.To ?? `user:${inbound.senderId}`) as string,
                accountId: route.accountId ?? accountId,
              }
            : undefined;

        const recordSessionKey =
          typeof finalCtx.SessionKey === "string" && finalCtx.SessionKey.trim()
            ? finalCtx.SessionKey
            : routeSessionKey;

        await sessionApi.recordInboundSession({
          storePath,
          sessionKey: recordSessionKey,
          ctx: finalCtx,
          updateLastRoute,
          onRecordError: (err: unknown) => {
            logger.warn(`failed to record inbound session: ${String(err)}`);
          },
        });
      } catch (err) {
        logger.warn(`failed to record inbound session: ${String(err)}`);
      }
    }

    const textApi = runtime.channel?.text;
    const limit =
      textApi?.resolveTextChunkLimit?.({
        cfg,
        channel: "qqbot",
        defaultLimit: qqCfg.textChunkLimit ?? 1500,
      }) ?? (qqCfg.textChunkLimit ?? 1500);

    const chunkMode = textApi?.resolveChunkMode?.(cfg, "qqbot");
    const tableMode = textApi?.resolveMarkdownTableMode?.({
      cfg,
      channel: "qqbot",
      accountId: route.accountId ?? accountId,
    });
    const resolvedTableMode = tableMode ?? "bullets";
    const chunkText = (text: string): string[] => {
      if (textApi?.chunkMarkdownText && limit > 0) {
        return textApi.chunkMarkdownText(text, limit);
      }
      if (textApi?.chunkTextWithMode && limit > 0) {
        return textApi.chunkTextWithMode(text, limit, chunkMode);
      }
      return [text];
    };

    const replyFinalOnly = qqCfg.replyFinalOnly ?? false;
    const markdownSupport = qqCfg.markdownSupport ?? true;
    const c2cMarkdownDeliveryMode = qqCfg.c2cMarkdownDeliveryMode ?? "proactive-table-only";
    const useC2CMarkdownTransport = markdownSupport && isQQBotC2CTarget(target.to);
    let bufferedC2CMarkdownTexts: string[] = [];
    let bufferedC2CMarkdownMediaUrls: string[] = [];
    const bufferedC2CMarkdownMediaSeen = new Set<string>();

    const bufferC2CMarkdownMedia = (url?: string): void => {
      const next = url?.trim();
      if (!next || bufferedC2CMarkdownMediaSeen.has(next)) return;
      bufferedC2CMarkdownMediaSeen.add(next);
      bufferedC2CMarkdownMediaUrls.push(next);
    };

    const flushBufferedC2CMarkdownReply = async (): Promise<void> => {
      if (
        !useC2CMarkdownTransport ||
        (bufferedC2CMarkdownTexts.length === 0 && bufferedC2CMarkdownMediaUrls.length === 0)
      ) {
        bufferedC2CMarkdownTexts = [];
        bufferedC2CMarkdownMediaUrls = [];
        bufferedC2CMarkdownMediaSeen.clear();
        return;
      }

      const combinedText = bufferedC2CMarkdownTexts.join("\n\n").trim();
      const combinedMediaUrls = [...bufferedC2CMarkdownMediaUrls];
      bufferedC2CMarkdownTexts = [];
      bufferedC2CMarkdownMediaUrls = [];
      bufferedC2CMarkdownMediaSeen.clear();

      const normalizedCombinedText = normalizeQQBotRenderedMarkdown(combinedText);
      const { markdownImageUrls, mediaQueue } = splitQQBotMarkdownTransportMediaUrls(combinedMediaUrls);
      const finalMarkdownText = await normalizeQQBotMarkdownImages({
        text: normalizedCombinedText,
        appendImageUrls: markdownImageUrls,
      });
      const textReplyRefs = resolveQQBotTextReplyRefs({
        to: target.to,
        text: finalMarkdownText || normalizedCombinedText,
        markdownSupport,
        c2cMarkdownDeliveryMode,
        replyToId: inbound.messageId,
        replyEventId: inbound.eventId,
      });
      const textSegments = finalMarkdownText ? [finalMarkdownText] : [];
      const deliveryLabel = textReplyRefs.forceProactive
        ? "c2c-markdown-proactive"
        : "c2c-markdown-passive";
      logger.info(
        `delivery=${deliveryLabel} to=${target.to} segments=${textSegments.length} media=${mediaQueue.length} ` +
          `replyToId=${textReplyRefs.replyToId ? "yes" : "no"} replyEventId=${textReplyRefs.replyEventId ? "yes" : "no"} ` +
          `tableMode=${String(resolvedTableMode)} chunkMode=${String(chunkMode ?? "default")}`
      );

      await sendQQBotMediaWithFallback({
        qqCfg,
        to: target.to,
        mediaQueue,
        replyToId: textReplyRefs.replyToId,
        replyEventId: textReplyRefs.replyEventId,
        logger,
        onDelivered: () => {
          markReplyDelivered();
        },
        onError: (error) => {
          markGroupMessageInterfaceBlocked(error);
        },
      });

      if (!finalMarkdownText) {
        return;
      }

      for (let segmentIndex = 0; segmentIndex < textSegments.length; segmentIndex += 1) {
        const segment = textSegments[segmentIndex] ?? "";
        const chunks = chunkText(segment);
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const chunk = chunks[chunkIndex] ?? "";
          logger.info(
            `delivery=${deliveryLabel} segment=${segmentIndex + 1}/${textSegments.length} ` +
              `chunk=${chunkIndex + 1}/${chunks.length} preview=${formatQQBotOutboundPreview(chunk)}`
          );
          const result = await qqbotOutbound.sendText({
            cfg: { channels: { qqbot: qqCfg } },
            to: target.to,
            text: chunk,
            replyToId: textReplyRefs.replyToId,
            replyEventId: textReplyRefs.replyEventId,
          });
          if (result.error) {
            logger.error(`send buffered QQ markdown reply failed: ${result.error}`);
            markGroupMessageInterfaceBlocked(result.error);
          } else {
            logger.info(`sent buffered QQ markdown reply (len=${chunk.length})`);
            markReplyDelivered();
          }
        }
      }
    };

    const deliver = async (payload: unknown, info?: { kind?: string }): Promise<void> => {
      const typed = payload as { text?: string; mediaUrl?: string; mediaUrls?: string[] } | undefined;
      const extractedTextMedia = extractQQBotReplyMedia({
        text: typed?.text ?? "",
        logger,
        autoSendLocalPathMedia: resolveQQBotAutoSendLocalPathMedia(qqCfg),
      });
      const cleanedText = sanitizeQQBotOutboundText(extractedTextMedia.text);

      const payloadMediaUrls = Array.isArray(typed?.mediaUrls)
        ? typed?.mediaUrls
        : typed?.mediaUrl
          ? [typed.mediaUrl]
          : [];

      const mediaQueue: string[] = [];
      const seenMedia = new Set<string>();
      const addMedia = (value?: string) => {
        const next = value?.trim();
        if (!next) return;
        if (seenMedia.has(next)) return;
        seenMedia.add(next);
        mediaQueue.push(next);
      };

      for (const url of payloadMediaUrls) addMedia(url);
      for (const url of extractedTextMedia.mediaUrls) addMedia(url);

      const deliveryDecision = evaluateReplyFinalOnlyDelivery({
        replyFinalOnly,
        kind: info?.kind,
        hasMedia: mediaQueue.length > 0,
        sanitizedText: cleanedText,
      });
      if (deliveryDecision.skipDelivery) return;

      const suppressEchoText =
        mediaQueue.length > 0 &&
        shouldSuppressQQBotTextWhenMediaPresent(extractedTextMedia.text, cleanedText);
      const suppressText = deliveryDecision.suppressText || suppressEchoText;
      const textToSend = suppressText ? "" : cleanedText;

      if (useC2CMarkdownTransport) {
        if (textToSend) {
          bufferedC2CMarkdownTexts = appendQQBotBufferedText(bufferedC2CMarkdownTexts, textToSend);
        }

        for (const url of mediaQueue) {
          bufferC2CMarkdownMedia(url);
        }
        return;
      }

      if (textToSend) {
        const converted = textApi?.convertMarkdownTables
          ? textApi.convertMarkdownTables(textToSend, resolvedTableMode)
          : textToSend;
        const textReplyRefs = resolveQQBotTextReplyRefs({
          to: target.to,
          text: converted,
          markdownSupport,
          c2cMarkdownDeliveryMode,
          replyToId: inbound.messageId,
          replyEventId: inbound.eventId,
        });
        const chunks = chunkText(converted);
        for (const chunk of chunks) {
          const result = await qqbotOutbound.sendText({
            cfg: { channels: { qqbot: qqCfg } },
            to: target.to,
            text: chunk,
            replyToId: textReplyRefs.replyToId,
            replyEventId: textReplyRefs.replyEventId,
          });
          if (result.error) {
            logger.error(`sendText failed: ${result.error}`);
            markGroupMessageInterfaceBlocked(result.error);
          } else {
            markReplyDelivered();
          }
        }
      }

      await sendQQBotMediaWithFallback({
        qqCfg,
        to: target.to,
        mediaQueue,
        replyToId: inbound.messageId,
        replyEventId: inbound.eventId,
        logger,
        onDelivered: () => {
          markReplyDelivered();
        },
        onError: (error) => {
          markGroupMessageInterfaceBlocked(error);
        },
      });
    };

    const humanDelay = replyApi.resolveHumanDelayConfig?.(cfg, route.agentId);
    const dispatchBuffered = replyApi.dispatchReplyWithBufferedBlockDispatcher;
    if (dispatchBuffered) {
      await dispatchBuffered({
        ctx: finalCtx,
        cfg,
        dispatcherOptions: {
          deliver,
          humanDelay,
          onError: (err: unknown, info: { kind: string }) => {
            logger.error(`${info.kind} reply failed: ${String(err)}`);
          },
          onSkip: (_payload: unknown, info: { kind: string; reason: string }) => {
            if (info.reason !== "silent") {
              logger.info(`reply skipped: ${info.reason}`);
            }
          },
        },
      });
      await flushBufferedC2CMarkdownReply();
    } else {
      const dispatcherResult = replyApi.createReplyDispatcherWithTyping
        ? replyApi.createReplyDispatcherWithTyping({
            deliver,
            humanDelay,
            onError: (err: unknown, info: { kind: string }) => {
              logger.error(`${info.kind} reply failed: ${String(err)}`);
            },
          })
        : {
            dispatcher: replyApi.createReplyDispatcher?.({
              deliver,
              humanDelay,
              onError: (err: unknown, info: { kind: string }) => {
                logger.error(`${info.kind} reply failed: ${String(err)}`);
              },
            }),
            replyOptions: {},
            markDispatchIdle: () => undefined,
          };

      if (!dispatcherResult.dispatcher || !replyApi.dispatchReplyFromConfig) {
        logger.warn("dispatcher not available, skipping reply");
        return;
      }

      await replyApi.dispatchReplyFromConfig({
        ctx: finalCtx,
        cfg,
        dispatcher: dispatcherResult.dispatcher,
        replyOptions: dispatcherResult.replyOptions,
      });

      dispatcherResult.markDispatchIdle?.();
      await flushBufferedC2CMarkdownReply();
    }

    const noReplyFallback = resolveQQBotNoReplyFallback({
      inbound,
      replyDelivered,
    });
    if (noReplyFallback && !groupMessageInterfaceBlocked) {
      logger.info("no visible reply generated for group mention; sending fallback text");
      const fallbackResult = await qqbotOutbound.sendText({
        cfg: { channels: { qqbot: qqCfg } },
        to: target.to,
        text: noReplyFallback,
        replyToId: inbound.messageId,
        replyEventId: inbound.eventId,
      });
      if (fallbackResult.error) {
        logger.error(`sendText no-reply fallback failed: ${fallbackResult.error}`);
        markGroupMessageInterfaceBlocked(fallbackResult.error);
      } else {
        markReplyDelivered();
      }
    }
  } finally {
    longTaskNotice.dispose();
    try {
      await pruneInboundMediaDir({
        inboundDir: inboundMediaDir,
        keepDays: inboundMediaKeepDays,
      });
    } catch (err) {
      logger.warn(`failed to prune qqbot inbound media dir: ${String(err)}`);
    }
  }
}

function shouldHandleMessage(event: QQInboundMessage, qqCfg: QQBotAccountConfig, logger: Logger): boolean {
  if (event.type === "direct") {
    const dmPolicy = qqCfg.dmPolicy ?? "open";
    const allowed = checkDmPolicy({
      dmPolicy,
      senderId: event.senderId,
      allowFrom: qqCfg.allowFrom ?? [],
    });
    if (!allowed.allowed) {
      logger.info(`dm blocked: ${allowed.reason ?? "policy"}`);
      return false;
    }
    return true;
  }

  const groupPolicy = qqCfg.groupPolicy ?? "open";
  const conversationId =
    event.type === "group"
      ? event.groupOpenid ?? ""
      : event.channelId ?? "";
  const allowed = checkGroupPolicy({
    groupPolicy,
    conversationId,
    groupAllowFrom: qqCfg.groupAllowFrom ?? [],
    requireMention: qqCfg.requireMention ?? true,
    mentionedBot: event.mentionedBot,
  });
  if (!allowed.allowed) {
    logger.info(`group blocked: ${allowed.reason ?? "policy"}`);
    return false;
  }
  return true;
}

export async function handleQQBotDispatch(params: DispatchParams): Promise<void> {
  const logger = params.logger ?? createLogger("qqbot");
  const inbound = resolveInbound(params.eventType, params.eventData, params.eventId);
  if (!inbound) {
    return;
  }

  const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
  const qqCfg = params.cfg ? mergeQQBotAccountConfig(params.cfg, accountId) : undefined;
  if (!qqCfg) {
    logger.warn("qqbot config missing, ignoring inbound message");
    return;
  }
  if (qqCfg.enabled === false) {
    logger.info("qqbot disabled, ignoring inbound message");
    return;
  }

  const content = inbound.content.trim();
  const inboundLogContent = sanitizeInboundLogText(
    resolveInboundLogContent({
      content,
      attachments: inbound.attachments,
    })
  );
  logger.info(`[inbound-user] accountId=${accountId} senderId=${inbound.senderId} content=${inboundLogContent}`);

  if (!shouldHandleMessage(inbound, qqCfg, logger)) {
    return;
  }

  const knownTarget = resolveKnownQQBotTargetFromInbound({ inbound, accountId });
  if (knownTarget) {
    try {
      upsertKnownQQBotTarget({ target: knownTarget });
    } catch (err) {
      logger.warn(`failed to record known qqbot target: ${String(err)}`);
    }
  }

  const attachmentCount = inbound.attachments?.length ?? 0;
  if (attachmentCount > 0) {
    logger.info(`inbound message includes ${attachmentCount} attachment(s)`);
  }
  if (!content && attachmentCount === 0) {
    return;
  }

  const runtime = getQQBotRuntime();
  const routing = runtime.channel?.routing?.resolveAgentRoute;
  if (!routing) {
    logger.warn("routing API not available");
    return;
  }

  const target = resolveChatTarget(inbound);
  const route = routing({
    cfg: params.cfg,
    channel: "qqbot",
    accountId,
    peer: { kind: target.peerKind, id: target.peerId },
  }) as QQBotAgentRoute;
  const effectiveSessionKey = resolveQQBotEffectiveSessionKey({
    inbound,
    route,
    accountId,
  });
  const resolvedRoute =
    effectiveSessionKey === route.sessionKey
      ? route
      : { ...route, effectiveSessionKey };
  const queueKey = buildSessionDispatchQueueKey(resolvedRoute);
  if (sessionDispatchQueue.has(queueKey)) {
    logger.info(`session busy; queueing inbound dispatch sessionKey=${resolveQQBotRouteSessionKey(resolvedRoute)}`);
  }

  await runSerializedSessionDispatch(queueKey, async () =>
    dispatchToAgent({
      inbound: { ...inbound, content },
      cfg: params.cfg,
      qqCfg,
      accountId,
      logger,
      route: resolvedRoute,
    })
  );
}
