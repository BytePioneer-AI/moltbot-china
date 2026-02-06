export type { QQBotConfig } from "./config.js";

export interface ResolvedQQBotAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  appId?: string;
  markdownSupport?: boolean;
}

export interface QQBotSendResult {
  channel: "qqbot";
  messageId?: string;
  timestamp?: number | string;
  error?: string;
}

export type QQChatType = "direct" | "group" | "channel";

export interface QQInboundAttachment {
  url: string;
  filename?: string;
  contentType?: string;
  size?: number;
}

export interface QQInboundMessage {
  type: QQChatType;
  senderId: string;
  senderName?: string;
  content: string;
  attachments?: QQInboundAttachment[];
  messageId: string;
  timestamp: number;
  groupOpenid?: string;
  channelId?: string;
  guildId?: string;
  mentionedBot: boolean;
}

export interface InboundContext {
  Body: string;
  RawBody: string;
  CommandBody: string;
  BodyForAgent?: string;
  BodyForCommands?: string;
  From: string;
  To: string;
  SessionKey: string;
  AccountId: string;
  ChatType: "direct" | "group";
  GroupSubject?: string;
  SenderName?: string;
  SenderId: string;
  Provider: "qqbot";
  MessageSid: string;
  Timestamp: number;
  WasMentioned: boolean;
  CommandAuthorized: boolean;
  OriginatingChannel: "qqbot";
  OriginatingTo: string;
}
