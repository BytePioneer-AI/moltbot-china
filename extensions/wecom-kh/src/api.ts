/**
 * 企业微信客户渠道 API
 *
 * 提供 Access Token 缓存、消息拉取和发送能力
 */
import type { ResolvedWecomKhAccount, WecomKhSendTarget, AccessTokenCacheEntry, SyncMsgResponse } from "./types.js";
import { resolveApiBaseUrl } from "./config.js";

/** Access Token 缓存 (key: corpId:kh) */
const accessTokenCache = new Map<string, AccessTokenCacheEntry>();

/** Access Token 有效期: 2小时减去5分钟缓冲 */
const ACCESS_TOKEN_TTL_MS = 7200 * 1000 - 5 * 60 * 1000;

function buildWecomApiUrl(account: ResolvedWecomKhAccount, pathWithQuery: string): string {
  const normalizedPath = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  return `${resolveApiBaseUrl(account.config)}${normalizedPath}`;
}

function resolveOpenKfId(account: ResolvedWecomKhAccount, override?: string): string | undefined {
  const candidate = override?.trim() || account.openKfId?.trim() || account.agentId?.trim();
  return candidate || undefined;
}

/**
 * 移除 Markdown 格式，转换为纯文本
 * 企业微信客户文本消息不支持 Markdown
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // 1. 代码块：提取内容并缩进
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return "";
    const langLabel = lang ? `[${lang}]\n` : "";
    const indentedCode = trimmedCode
      .split("\n")
      .map((line: string) => `    ${line}`)
      .join("\n");
    return `\n${langLabel}${indentedCode}\n`;
  });

  // 2. 标题：用【】标记
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "【$1】");

  // 3. 粗体/斜体：保留文字
  result = result
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<![\w/])_(.+?)_(?![\w/])/g, "$1");

  // 4. 列表项转为点号
  result = result.replace(/^[-*]\s+/gm, "· ");

  // 5. 有序列表保持编号
  result = result.replace(/^(\d+)\.\s+/gm, "$1. ");

  // 6. 行内代码保留内容
  result = result.replace(/`([^`]+)`/g, "$1");

  // 7. 删除线
  result = result.replace(/~~(.*?)~~/g, "$1");

  // 8. 链接：保留文字和 URL
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // 9. 图片：显示 alt 文字
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片: $1]");

  // 10. 引用块：去掉 > 前缀
  result = result.replace(/^>\s?/gm, "");

  // 11. 水平线
  result = result.replace(/^[-*_]{3,}$/gm, "────────────");

  // 12. 多个换行合并
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * 获取 Access Token（带缓存）
 * 使用 corpId + khSecret 获取，专用于微信客服接口
 */
export async function getAccessToken(account: ResolvedWecomKhAccount): Promise<string> {
  if (!account.corpId || !account.khSecret) {
    throw new Error("corpId or khSecret not configured");
  }

  const key = `${account.corpId}:kh`;
  const cached = accessTokenCache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const url = buildWecomApiUrl(
    account,
    `/cgi-bin/gettoken?corpid=${encodeURIComponent(account.corpId)}&corpsecret=${encodeURIComponent(account.khSecret)}`
  );
  const resp = await fetch(url);
  const data = (await resp.json()) as { errcode?: number; errmsg?: string; access_token?: string };

  if (data.errcode !== undefined && data.errcode !== 0) {
    throw new Error(`gettoken failed: ${data.errmsg ?? "unknown error"} (errcode=${data.errcode})`);
  }

  if (!data.access_token) {
    throw new Error("gettoken returned empty access_token");
  }

  accessTokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  });

  return data.access_token;
}

/**
 * 清除指定账户的 Access Token 缓存
 */
export function clearAccessTokenCache(account: ResolvedWecomKhAccount): void {
  const key = `${account.corpId}:kh`;
  accessTokenCache.delete(key);
}

/**
 * 清除所有 Access Token 缓存
 */
export function clearAllAccessTokenCache(): void {
  accessTokenCache.clear();
}

/** 发送消息结果 */
export type SendMessageResult = {
  ok: boolean;
  errcode?: number;
  errmsg?: string;
  msgid?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// sync_msg: 拉取客服消息
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 拉取微信客服消息
 *
 * 收到回调通知后，调用此接口主动拉取消息内容
 */
export async function syncMessages(
  account: ResolvedWecomKhAccount,
  cursor?: string,
  callbackToken?: string,
  limit = 1000,
  openKfIdOverride?: string,
): Promise<SyncMsgResponse> {
  const openKfId = resolveOpenKfId(account, openKfIdOverride);

  if (!account.corpId || !account.khSecret || !openKfId) {
    return { errcode: -1, errmsg: "Account not configured for sync_msg (missing corpId, khSecret, or openKfId)" };
  }

  const accessToken = await getAccessToken(account);
  const url = buildWecomApiUrl(
    account,
    `/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`
  );

  const payload: Record<string, unknown> = {
    open_kfid: openKfId,
    limit,
  };

  if (cursor) {
    payload.cursor = cursor;
  }
  if (callbackToken) {
    payload.token = callbackToken;
  }

  const resp = await fetch(url, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });

  const data = (await resp.json()) as SyncMsgResponse;
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// send_msg: 发送客服消息
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 发送文本消息给微信客户
 *
 * 注意：仅在用户主动发消息后 48 小时内可发送，最多 5 条
 */
export async function sendKhMessage(
  account: ResolvedWecomKhAccount,
  target: WecomKhSendTarget,
  message: string,
): Promise<SendMessageResult> {
  const openKfId = resolveOpenKfId(account, target.openKfId);

  if (!account.corpId || !account.khSecret || !openKfId) {
    return {
      ok: false,
      errcode: -1,
      errmsg: "Account not configured for sending (missing corpId, khSecret, or openKfId)",
    };
  }

  const accessToken = await getAccessToken(account);
  const text = stripMarkdown(message);

  const payload: Record<string, unknown> = {
    touser: target.externalUserId,
    open_kfid: openKfId,
    msgtype: "text",
    text: { content: text },
  };

  const resp = await fetch(
    buildWecomApiUrl(account, `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`),
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    }
  );

  const data = (await resp.json()) as { errcode?: number; errmsg?: string; msgid?: string };

  return {
    ok: data.errcode === 0,
    errcode: data.errcode,
    errmsg: data.errmsg,
    msgid: data.msgid,
  };
}

/**
 * 发送图片消息给微信客户
 */
export async function sendKhImageMessage(
  account: ResolvedWecomKhAccount,
  target: WecomKhSendTarget,
  mediaId: string,
): Promise<SendMessageResult> {
  const openKfId = resolveOpenKfId(account, target.openKfId);

  if (!account.corpId || !account.khSecret || !openKfId) {
    return { ok: false, errcode: -1, errmsg: "Account not configured for sending" };
  }

  const accessToken = await getAccessToken(account);

  const payload: Record<string, unknown> = {
    touser: target.externalUserId,
    open_kfid: openKfId,
    msgtype: "image",
    image: { media_id: mediaId },
  };

  const resp = await fetch(
    buildWecomApiUrl(account, `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`),
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    }
  );

  const data = (await resp.json()) as { errcode?: number; errmsg?: string; msgid?: string };

  return {
    ok: data.errcode === 0,
    errcode: data.errcode,
    errmsg: data.errmsg,
    msgid: data.msgid,
  };
}

/**
 * 发送文件消息给微信客户
 */
export async function sendKhFileMessage(
  account: ResolvedWecomKhAccount,
  target: WecomKhSendTarget,
  mediaId: string,
): Promise<SendMessageResult> {
  const openKfId = resolveOpenKfId(account, target.openKfId);

  if (!account.corpId || !account.khSecret || !openKfId) {
    return { ok: false, errcode: -1, errmsg: "Account not configured for sending" };
  }

  const accessToken = await getAccessToken(account);

  const payload: Record<string, unknown> = {
    touser: target.externalUserId,
    open_kfid: openKfId,
    msgtype: "file",
    file: { media_id: mediaId },
  };

  const resp = await fetch(
    buildWecomApiUrl(account, `/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`),
    {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    }
  );

  const data = (await resp.json()) as { errcode?: number; errmsg?: string; msgid?: string };

  return {
    ok: data.errcode === 0,
    errcode: data.errcode,
    errmsg: data.errmsg,
    msgid: data.msgid,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 素材上传
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 上传临时素材获取 media_id
 */
export async function uploadMedia(
  account: ResolvedWecomKhAccount,
  buffer: Buffer,
  filename: string,
  type: "image" | "voice" | "video" | "file" = "image",
): Promise<string> {
  if (!account.canSend) {
    throw new Error("Account not configured for media upload");
  }

  const accessToken = await getAccessToken(account);
  const boundary = `----FormBoundary${Date.now()}`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="media"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, buffer, footer]);

  const resp = await fetch(
    buildWecomApiUrl(account, `/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=${type}`),
    {
      method: "POST",
      body: body,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
    }
  );

  const data = (await resp.json()) as { errcode?: number; errmsg?: string; media_id?: string };

  if (data.errcode !== undefined && data.errcode !== 0) {
    throw new Error(`Upload media failed: ${data.errmsg ?? "unknown error"} (errcode=${data.errcode})`);
  }

  if (!data.media_id) {
    throw new Error("Upload media returned empty media_id");
  }

  return data.media_id;
}

/**
 * 下载图片并发送
 */
export async function downloadAndSendImage(
  account: ResolvedWecomKhAccount,
  target: WecomKhSendTarget,
  imageUrl: string,
): Promise<SendMessageResult> {
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) {
      return { ok: false, errcode: -1, errmsg: `Download image failed: HTTP ${resp.status}` };
    }
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const urlPath = imageUrl.split("?")[0] ?? "";
    const ext = urlPath.split(".").pop() ?? "jpg";
    const filename = `image_${Date.now()}.${ext}`;

    const mediaId = await uploadMedia(account, buffer, filename, "image");
    return await sendKhImageMessage(account, target, mediaId);
  } catch (err) {
    return {
      ok: false,
      errcode: -1,
      errmsg: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 将长文本按字节长度分割成多个片段
 * 企业微信限制：每条消息最长 2048 字节
 */
export function splitMessageByBytes(text: string, maxBytes = 2048): string[] {
  const result: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");

    if (currentBytes + charBytes > maxBytes && current.length > 0) {
      result.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

/**
 * 将文本拆分成可发送的片段（去除 Markdown + 按字节切分）
 */
export function splitActiveTextChunks(text: string): string[] {
  const formatted = stripMarkdown(text).trim();
  if (!formatted) return [];
  return splitMessageByBytes(formatted, 2048).filter((chunk) => chunk.trim());
}
