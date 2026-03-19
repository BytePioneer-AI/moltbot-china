import { buildWechatMpSessionKey, buildWechatMpTarget } from "./config.js";
import type {
  ResolvedWechatMpAccount,
  WechatMpInboundCandidate,
  WechatMpInboundEventName,
  WechatMpInboundMessage,
} from "./types.js";

const INTENTFUL_EVENTS = new Set<WechatMpInboundEventName>(["subscribe", "scan", "click"]);
const TRACKED_EVENTS = new Set<WechatMpInboundEventName>([
  "subscribe",
  "unsubscribe",
  "scan",
  "click",
  "view",
]);

function normalizeEventName(raw: string | undefined): WechatMpInboundEventName | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (TRACKED_EVENTS.has(value as WechatMpInboundEventName)) {
    return value as WechatMpInboundEventName;
  }
  return undefined;
}

export function normalizeWechatMpInbound(params: {
  account: ResolvedWechatMpAccount;
  message: WechatMpInboundMessage;
  encrypted: boolean;
}): WechatMpInboundCandidate | null {
  const { account, message, encrypted } = params;
  const openId = String(message.FromUserName ?? "").trim();
  if (!openId) return null;

  const createTime = Number(message.CreateTime ?? 0) || 0;
  const target = buildWechatMpTarget(openId, account.accountId);
  const sessionKey = account.config.appId
    ? buildWechatMpSessionKey(account.config.appId, openId)
    : undefined;

  if (message.MsgType === "text") {
    const content = String(message.Content ?? "").trim();
    if (!content) return null;
    const msgId = String(message.MsgId ?? "").trim() || undefined;
    return {
      accountId: account.accountId,
      openId,
      appId: account.config.appId,
      target,
      sessionKey,
      createTime,
      msgType: "text",
      msgId,
      dedupeKey: msgId || `text:${account.accountId}:${openId}:${createTime}:${content}`,
      encrypted,
      hasUserIntent: true,
      content,
      toUserName: String(message.ToUserName ?? "").trim() || undefined,
      raw: message,
    };
  }

  if (message.MsgType === "event") {
    const eventValue =
      "Event" in message && typeof message.Event === "string"
        ? message.Event
        : undefined;
    const event = normalizeEventName(eventValue);
    if (!event) return null;
    const eventKey =
      "EventKey" in message && typeof message.EventKey === "string"
        ? message.EventKey.trim() || undefined
        : undefined;
    const ticket =
      "Ticket" in message && typeof message.Ticket === "string"
        ? message.Ticket.trim() || undefined
        : undefined;
    return {
      accountId: account.accountId,
      openId,
      appId: account.config.appId,
      target,
      sessionKey,
      createTime,
      msgType: "event",
      dedupeKey: `event:${account.accountId}:${openId}:${event}:${eventKey ?? ""}:${createTime}`,
      encrypted,
      hasUserIntent: INTENTFUL_EVENTS.has(event),
      event,
      eventKey,
      ticket,
      toUserName: String(message.ToUserName ?? "").trim() || undefined,
      raw: message,
    };
  }

  return null;
}
