/**
 * QQ Bot 发送消息（文件）
 */

import {
  getAccessToken,
  sendC2CMediaMessage,
  sendGroupMediaMessage,
  uploadC2CMedia,
  uploadGroupMedia,
  MediaFileType,
} from "./client.js";
import type { QQBotConfig } from "./types.js";
import {
  detectMediaType,
  FileSizeLimitError,
  HttpError,
  MediaTimeoutError,
  isHttpUrl,
  readMedia,
  stripTitleFromUrl,
} from "@openclaw-china/shared";

export type QQBotFileTarget = {
  kind: "c2c" | "group";
  id: string;
};

export interface SendFileQQBotParams {
  cfg: QQBotConfig;
  target: QQBotFileTarget;
  mediaUrl: string;
  messageId?: string;
}

const QQBOT_UNSUPPORTED_FILE_TYPE_MESSAGE =
  "QQ official C2C/group media API does not support generic files (file_type=4, e.g. PDF). Images and other supported media types are unaffected.";

function resolveQQBotMediaFileType(fileName: string): MediaFileType {
  const mediaType = detectMediaType(fileName);
  switch (mediaType) {
    case "image":
      return MediaFileType.IMAGE;
    case "video":
      return MediaFileType.VIDEO;
    case "audio":
      return MediaFileType.VOICE;
    default:
      return MediaFileType.FILE;
  }
}

async function uploadQQBotFile(params: {
  accessToken: string;
  target: QQBotFileTarget;
  fileType: MediaFileType;
  url?: string;
  fileData?: string;
}): Promise<string> {
  const { accessToken, target, fileType, url, fileData } = params;
  if (!url && !fileData) {
    throw new Error("QQBot file upload requires url or fileData");
  }
  const upload =
    target.kind === "group"
      ? await uploadGroupMedia({
          accessToken,
          groupOpenid: target.id,
          fileType,
          ...(url ? { url } : { fileData }),
        })
      : await uploadC2CMedia({
          accessToken,
          openid: target.id,
          fileType,
          ...(url ? { url } : { fileData }),
        });

  if (!upload.file_info) {
    throw new Error("QQBot file upload failed: no file_info returned");
  }
  return upload.file_info;
}

export async function sendFileQQBot(params: SendFileQQBotParams): Promise<{ id: string; timestamp: number | string }> {
  const { cfg, target, mediaUrl, messageId } = params;
  if (!cfg.appId || !cfg.clientSecret) {
    throw new Error("QQBot not configured (missing appId/clientSecret)");
  }

  const src = stripTitleFromUrl(mediaUrl);
  const fileType = resolveQQBotMediaFileType(src);
  if (fileType === MediaFileType.FILE) {
    throw new Error(QQBOT_UNSUPPORTED_FILE_TYPE_MESSAGE);
  }

  const sourceIsHttp = isHttpUrl(src);
  const maxFileSizeMB = cfg.maxFileSizeMB ?? 100;
  const mediaTimeoutMs = cfg.mediaTimeoutMs ?? 30000;
  const maxSizeBytes = Math.floor(maxFileSizeMB * 1024 * 1024);

  const accessToken = await getAccessToken(cfg.appId, cfg.clientSecret);
  let fileInfo: string;
  try {
    if (sourceIsHttp) {
      fileInfo = await uploadQQBotFile({
        accessToken,
        target,
        fileType,
        url: src,
      });
    } else {
      const { buffer } = await readMediaWithConfig(src, {
        timeout: mediaTimeoutMs,
        maxSize: maxSizeBytes,
      });
      fileInfo = await uploadQQBotFile({
        accessToken,
        target,
        fileType,
        fileData: buffer.toString("base64"),
      });
    }
  } catch (err) {
    const message = formatQQBotError(err);
    throw new Error(`QQBot media upload failed: ${message}`);
  }

  if (target.kind === "group") {
    try {
      return await sendGroupMediaMessage({
        accessToken,
        groupOpenid: target.id,
        fileInfo,
        messageId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`QQBot group media send failed: ${message}`);
    }
  }

  try {
    return await sendC2CMediaMessage({
      accessToken,
      openid: target.id,
      fileInfo,
      messageId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`QQBot C2C media send failed: ${message}`);
  }
}

function formatQQBotError(err: unknown): string {
  if (err instanceof HttpError) {
    const body = normalizeHttpErrorBody(err.body);
    return body ? `${err.message} - ${body}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function normalizeHttpErrorBody(body?: string): string | undefined {
  const trimmed = body?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const code = parsed.code;
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.msg === "string"
          ? parsed.msg
          : undefined;
    if (code !== undefined || message) {
      return `code=${String(code ?? "unknown")}, message=${message ?? "unknown"}`;
    }
  } catch {
    // keep raw response body
  }

  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
}

async function readMediaWithConfig(
  source: string,
  options: { timeout: number; maxSize: number }
): Promise<{ buffer: Buffer; fileName: string }> {
  try {
    return await readMedia(source, options);
  } catch (err) {
    if (err instanceof FileSizeLimitError) {
      const limitMB = (err.limitSize / (1024 * 1024)).toFixed(2);
      throw new Error(`QQBot media exceeds limit (${limitMB}MB)`);
    }
    if (err instanceof MediaTimeoutError) {
      throw new Error(`QQBot media read timed out after ${err.timeoutMs}ms`);
    }
    throw err;
  }
}
