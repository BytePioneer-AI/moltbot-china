/**
 * 微信客服渠道消息处理
 *
 * 将拉取到的消息分发给 OpenClaw Agent
 */

import {
  appendCronHiddenPrompt,
  checkDmPolicy,
  createLogger,
  type Logger,
} from "@openclaw-china/shared";

import type { PluginRuntime } from "./runtime.js";
import type { ResolvedWecomKfAccount, WecomKfInboundMessage, WecomKfDmPolicy } from "./types.js";
import {
  resolveAllowFrom,
  resolveDmPolicy,
  type PluginConfig,
} from "./config.js";

export type WecomKfDispatchHooks = {
  onChunk: (text: string) => void | Promise<void>;
  onError?: (err: unknown) => void;
};

/**
 * 提取消息内容
 */
export function extractWecomKfContent(msg: WecomKfInboundMessage): string {
  const msgtype = String(msg.msgtype ?? "").toLowerCase();

  if (msgtype === "text") {
    const content = (msg as { text?: { content?: string } }).text?.content;
    return typeof content === "string" ? content : "";
  }
  if (msgtype === "image") {
    const mediaId = (msg as { image?: { media_id?: string } }).image?.media_id;
    return mediaId ? `[image] media_id:${mediaId}` : "[image]";
  }
  if (msgtype === "voice") {
    const mediaId = (msg as { voice?: { media_id?: string } }).voice?.media_id;
    return mediaId ? `[voice] media_id:${mediaId}` : "[voice]";
  }
  if (msgtype === "video") {
    const mediaId = (msg as { video?: { media_id?: string } }).video?.media_id;
    return mediaId ? `[video] media_id:${mediaId}` : "[video]";
  }
  if (msgtype === "file") {
    const mediaId = (msg as { file?: { media_id?: string } }).file?.media_id;
    return mediaId ? `[file] media_id:${mediaId}` : "[file]";
  }
  if (msgtype === "location") {
    const loc = (msg as { location?: { latitude?: number; longitude?: number; name?: string; address?: string } }).location;
    const parts: string[] = [];
    if (loc?.latitude !== undefined && loc?.longitude !== undefined) {
      parts.push(`${loc.latitude},${loc.longitude}`);
    }
    if (loc?.name) parts.push(loc.name);
    if (loc?.address) parts.push(loc.address);
    return parts.length ? `[location] ${parts.join(" ")}` : "[location]";
  }
  if (msgtype === "link") {
    const link = (msg as { link?: { title?: string; desc?: string; url?: string } }).link;
    const parts: string[] = [];
    if (link?.title) parts.push(link.title);
    if (link?.url) parts.push(link.url);
    return parts.length ? `[link] ${parts.join(" ")}` : "[link]";
  }
  if (msgtype === "business_card") {
    const userid = (msg as { business_card?: { userid?: string } }).business_card?.userid;
    return userid ? `[business_card] ${userid}` : "[business_card]";
  }
  if (msgtype === "miniprogram") {
    const mp = (msg as { miniprogram?: { title?: string; appid?: string } }).miniprogram;
    return mp?.title ? `[miniprogram] ${mp.title}` : "[miniprogram]";
  }
  if (msgtype === "event") {
    const eventType = (msg as { event?: { event_type?: string } }).event?.event_type;
    return eventType ? `[event] ${eventType}` : "[event]";
  }
  return msgtype ? `[${msgtype}]` : "";
}

function resolveSenderId(msg: WecomKfInboundMessage): string {
  return msg.external_userid?.trim() || "unknown";
}

function resolveChatId(_msg: WecomKfInboundMessage, senderId: string): string {
  return senderId;
}

/**
 * 分发微信客服消息
 */
export async function dispatchWecomKfMessage(params: {
  cfg?: PluginConfig;
  account: ResolvedWecomKfAccount;
  msg: WecomKfInboundMessage;
  core: PluginRuntime;
  hooks: WecomKfDispatchHooks;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}): Promise<void> {
  const { cfg, account, msg, core, hooks } = params;
  const safeCfg = (cfg ?? {}) as PluginConfig;

  const logger: Logger = createLogger("wecom-kf", { log: params.log, error: params.error });

  const senderId = resolveSenderId(msg);
  const chatId = resolveChatId(msg, senderId);

  const accountConfig = account?.config ?? {};

  // DM 策略检查
  const dmPolicy = resolveDmPolicy(accountConfig);
  const allowFrom = resolveAllowFrom(accountConfig);

  const policyResult = checkDmPolicy({
    dmPolicy,
    senderId,
    allowFrom,
  });

  if (!policyResult.allowed) {
    logger.debug(`policy rejected: ${policyResult.reason}`);
    return;
  }

  const channel = core.channel;
  if (!channel?.routing?.resolveAgentRoute || !channel.reply?.dispatchReplyWithBufferedBlockDispatcher) {
    logger.debug("core routing or buffered dispatcher missing, skipping dispatch");
    return;
  }

  const route = channel.routing.resolveAgentRoute({
    cfg: safeCfg,
    channel: "wecom-kf",
    accountId: account.accountId,
    peer: { kind: "dm", id: chatId },
  });

  const rawBody = extractWecomKfContent(msg);
  const fromLabel = `user:${senderId}`;

  const storePath = channel.session?.resolveStorePath?.(safeCfg.session?.store, {
    agentId: route.agentId,
  });

  const previousTimestamp = channel.session?.readSessionUpdatedAt
    ? channel.session.readSessionUpdatedAt({
        storePath,
        sessionKey: route.sessionKey,
      }) ?? undefined
    : undefined;

  const envelopeOptions = channel.reply?.resolveEnvelopeFormatOptions
    ? channel.reply.resolveEnvelopeFormatOptions(safeCfg)
    : undefined;

  const body = channel.reply?.formatAgentEnvelope
    ? channel.reply.formatAgentEnvelope({
        channel: "WeCom KF",
        from: fromLabel,
        previousTimestamp,
        envelope: envelopeOptions,
        body: rawBody,
      })
    : rawBody;

  const msgid = msg.msgid ?? undefined;

  const from = `wecom-kf:user:${senderId}`;
  const to = `user:${senderId}`;

  const ctxPayload = (channel.reply?.finalizeInboundContext
    ? channel.reply.finalizeInboundContext({
        Body: body,
        RawBody: rawBody,
        CommandBody: rawBody,
        From: from,
        To: to,
        SessionKey: route.sessionKey,
        AccountId: route.accountId ?? account.accountId,
        ChatType: "direct",
        ConversationLabel: fromLabel,
        SenderName: senderId,
        SenderId: senderId,
        Provider: "wecom-kf",
        Surface: "wecom-kf",
        MessageSid: msgid,
        OriginatingChannel: "wecom-kf",
        OriginatingTo: to,
      })
    : {
        Body: body,
        RawBody: rawBody,
        CommandBody: rawBody,
        From: from,
        To: to,
        SessionKey: route.sessionKey,
        AccountId: route.accountId ?? account.accountId,
        ChatType: "direct",
        ConversationLabel: fromLabel,
        SenderName: senderId,
        SenderId: senderId,
        Provider: "wecom-kf",
        Surface: "wecom-kf",
        MessageSid: msgid,
        OriginatingChannel: "wecom-kf",
        OriginatingTo: to,
      }) as {
    SessionKey?: string;
    [key: string]: unknown;
  };

  const ctxTo =
    typeof ctxPayload.To === "string" && ctxPayload.To.trim()
      ? ctxPayload.To.trim()
      : undefined;
  const ctxOriginatingTo =
    typeof ctxPayload.OriginatingTo === "string" && ctxPayload.OriginatingTo.trim()
      ? ctxPayload.OriginatingTo.trim()
      : undefined;
  const stableTo = ctxOriginatingTo ?? ctxTo ?? to;
  ctxPayload.To = stableTo;
  ctxPayload.OriginatingTo = stableTo;

  ctxPayload.SenderId = senderId;
  ctxPayload.SenderName = senderId;
  ctxPayload.ConversationLabel = fromLabel;
  ctxPayload.CommandAuthorized = true;

  let cronBase = "";
  if (typeof ctxPayload.RawBody === "string" && ctxPayload.RawBody) {
    cronBase = ctxPayload.RawBody;
  } else if (typeof ctxPayload.Body === "string" && ctxPayload.Body) {
    cronBase = ctxPayload.Body;
  }

  if (cronBase) {
    const nextCron = appendCronHiddenPrompt(cronBase);
    if (nextCron !== cronBase) {
      ctxPayload.BodyForAgent = nextCron;
    }
  }

  if (channel.session?.recordInboundSession && storePath) {
    const mainSessionKeyRaw = (route as Record<string, unknown>)?.mainSessionKey;
    const mainSessionKey =
      typeof mainSessionKeyRaw === "string" && mainSessionKeyRaw.trim()
        ? mainSessionKeyRaw
        : undefined;
    const updateLastRoute = {
      sessionKey: mainSessionKey ?? route.sessionKey,
      channel: "wecom-kf",
      to: stableTo,
      accountId: route.accountId ?? account.accountId,
    };
    const recordSessionKeyRaw = ctxPayload.SessionKey ?? route.sessionKey;
    const recordSessionKey =
      typeof recordSessionKeyRaw === "string" && recordSessionKeyRaw.trim()
        ? recordSessionKeyRaw
        : route.sessionKey;

    await channel.session.recordInboundSession({
      storePath,
      sessionKey: recordSessionKey,
      ctx: ctxPayload,
      updateLastRoute,
      onRecordError: (err: unknown) => {
        logger.error(`wecom-kf: failed updating session meta: ${String(err)}`);
      },
    });
  }

  const tableMode = channel.text?.resolveMarkdownTableMode
    ? channel.text.resolveMarkdownTableMode({ cfg: safeCfg, channel: "wecom-kf", accountId: account.accountId })
    : undefined;

  await channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: safeCfg,
    dispatcherOptions: {
      deliver: async (payload: { text?: string }) => {
        const rawText = payload.text ?? "";
        if (!rawText.trim()) return;
        const converted = channel.text?.convertMarkdownTables && tableMode
          ? channel.text.convertMarkdownTables(rawText, tableMode)
          : rawText;
        await hooks.onChunk(converted);
      },
      onError: (err: unknown, info: { kind: string }) => {
        hooks.onError?.(err);
        logger.error(`${info.kind} reply failed: ${String(err)}`);
      },
    },
  });
}
