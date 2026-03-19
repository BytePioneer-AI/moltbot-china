import type { IncomingMessage, ServerResponse } from "http";

/**
 * ============================================================================
 * TARGET AND SESSION KEY CONVENTIONS
 * ============================================================================
 *
 * External Target Format (user-facing):
 *   - Primary: `user:<openid>` (openid-only, uses default account)
 *   - With account: `user:<openid>@<accountId>` (explicit account)
 *   - Legacy: `wechat-mp:user:<openid>` or `wechat-mp:user:<openid>@<accountId>`
 *
 * Internal Session Key Format (stable, internal):
 *   - Pattern: `dm:<appId>:<openid>`
 *   - The appId provides namespace isolation for multi-tenant scenarios
 *   - The openid is the stable user identifier from WeChat
 *
 * Why split external/internal:
 *   - External: User-friendly, can omit account, follows OpenClaw conventions
 *   - Internal: Stable, includes appId for multi-account isolation
 *
 * Account Resolution:
 *   - If accountId is provided: use accounts.<accountId> with root fallback
 *   - If no accountId: use root config as "default" account
 *   - Multi-account schema is day-one ready but setup CLI focuses on single account
 */

/**
 * WeChat MP DM policy for controlling direct message acceptance.
 */
export type WechatMpDmPolicy = "open" | "pairing" | "allowlist" | "disabled";

/**
 * WeChat MP message encryption mode.
 * - plain: No encryption
 * - safe: Full encryption
 * - compat: Compatible mode (both encrypted and plain supported)
 */
export type WechatMpMessageMode = "plain" | "safe" | "compat";

/**
 * WeChat MP reply mode.
 * - passive: Reply within 5-second webhook timeout (passive reply)
 * - active: Use customer service API for active sending
 */
export type WechatMpReplyMode = "passive" | "active";

/**
 * WeChat MP active delivery mode.
 * - merged: Buffer all chunks and send one final active message
 * - split: Send each chunk as its own active message
 */
export type WechatMpActiveDeliveryMode = "merged" | "split";

/**
 * Per-account configuration for WeChat MP.
 */
export type WechatMpAccountConfig = {
  name?: string;
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encodingAESKey?: string;
  token?: string;
  webhookPath?: string;
  messageMode?: WechatMpMessageMode;
  replyMode?: WechatMpReplyMode;
  activeDeliveryMode?: WechatMpActiveDeliveryMode;
  welcomeText?: string;
  dmPolicy?: WechatMpDmPolicy;
  allowFrom?: string[];
};

/**
 * Root configuration for WeChat MP channel.
 * Supports multi-account via accounts object.
 */
export type WechatMpConfig = WechatMpAccountConfig & {
  accounts?: Record<string, WechatMpAccountConfig>;
  defaultAccount?: string;
};

/**
 * Plugin configuration interface (partial).
 */
export interface PluginConfig {
  session?: {
    store?: unknown;
  };
  channels?: Record<string, unknown> & {
    "wechat-mp"?: WechatMpConfig;
  };
  [key: string]: unknown;
}

/**
 * Resolved account with all configuration merged and validated.
 */
export type ResolvedWechatMpAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  appId?: string;
  appSecret?: string;
  encodingAESKey?: string;
  token?: string;
  canSendActive: boolean;
  config: WechatMpAccountConfig;
};

/**
 * WeChat MP access token cache entry.
 */
export type AccessTokenCacheEntry = {
  token: string;
  expiresAt: number;
};

/**
 * WeChat MP inbound text message structure.
 */
export type WechatMpTextMessage = {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: "text";
  Content: string;
  MsgId: string;
};

/**
 * WeChat MP inbound event message structure.
 */
export type WechatMpEventMessage = {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: "event";
  Event: string;
  EventKey?: string;
  Ticket?: string;
};

/**
 * WeChat MP inbound image message structure.
 */
export type WechatMpImageMessage = {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: "image";
  PicUrl: string;
  MediaId: string;
  MsgId: string;
};

/**
 * Union type for all WeChat MP inbound messages.
 */
export type WechatMpInboundMessage =
  | WechatMpTextMessage
  | WechatMpEventMessage
  | WechatMpImageMessage
  | (Record<string, unknown> & { MsgType: string });

/**
 * WeChat MP account state for tracking runtime status.
 */
export type WechatMpAccountState = {
  configured?: boolean;
  running?: boolean;
  webhookPath?: string;
  lastStartAt?: number;
  lastStopAt?: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  lastIntentfulAt?: number;
  lastError?: string;
  lastMessageId?: string;
  lastEvent?: string;
  lastFromUserName?: string;
};

/**
 * WeChat MP persisted state structure.
 */
export type WechatMpPersistedState = {
  version: 1;
  processedMsgIds: Record<string, number>;
  accounts: Record<string, WechatMpAccountState>;
};

export type WechatMpInboundEventName =
  | "subscribe"
  | "unsubscribe"
  | "scan"
  | "click"
  | "view";

export type WechatMpInboundCandidate = {
  accountId: string;
  openId: string;
  appId?: string;
  target: string;
  sessionKey?: string;
  createTime: number;
  msgType: "text" | "event";
  msgId?: string;
  dedupeKey: string;
  encrypted: boolean;
  hasUserIntent: boolean;
  content?: string;
  event?: WechatMpInboundEventName;
  eventKey?: string;
  ticket?: string;
  toUserName?: string;
  raw: WechatMpInboundMessage;
};

/**
 * Webhook target registration parameters.
 */
export type WebhookTarget = {
  account: ResolvedWechatMpAccount;
  config: PluginConfig;
  runtime: {
    log: (message: string) => void;
    error: (message: string) => void;
  };
  path: string;
  statusSink?: (patch: Record<string, unknown>) => void;
};

/**
 * Plugin runtime interface defining host capabilities needed by the plugin.
 */
export interface PluginRuntime {
  log?: (message: string) => void;
  error?: (message: string) => void;
  channel?: {
    routing?: {
      resolveAgentRoute?: (params: {
        cfg: unknown;
        channel: string;
        accountId?: string;
        peer: { kind: string; id: string };
      }) => {
        sessionKey: string;
        accountId: string;
        agentId?: string;
        mainSessionKey?: string;
      };
    };
    reply?: {
      dispatchReplyWithBufferedBlockDispatcher?: (params: {
        ctx: unknown;
        cfg: unknown;
        dispatcherOptions: {
          deliver: (payload: { text?: string }) => Promise<void>;
          onError?: (err: unknown, info: { kind: string }) => void;
        };
      }) => Promise<void>;
      finalizeInboundContext?: (ctx: unknown) => unknown;
      resolveEnvelopeFormatOptions?: (cfg: unknown) => unknown;
      formatAgentEnvelope?: (params: {
        channel: string;
        from: string;
        previousTimestamp?: number;
        envelope?: unknown;
        body: string;
      }) => string;
    };
    session?: {
      resolveStorePath?: (
        store: unknown,
        params: { agentId?: string }
      ) => string | undefined;
      readSessionUpdatedAt?: (params: {
        storePath?: string;
        sessionKey: string;
      }) => number | null;
      recordInboundSession?: (params: {
        storePath: string;
        sessionKey: string;
        ctx: unknown;
        updateLastRoute?: {
          sessionKey: string;
          channel: string;
          to: string;
          accountId?: string;
          threadId?: string | number;
        };
        onRecordError?: (err: unknown) => void;
      }) => Promise<void>;
    };
    text?: {
      resolveMarkdownTableMode?: (params: {
        cfg: unknown;
        channel: string;
        accountId?: string;
      }) => unknown;
      convertMarkdownTables?: (text: string, mode: unknown) => string;
    };
  };
  [key: string]: unknown;
}

type HttpRouteMatch = "exact" | "prefix";
type HttpRouteAuth = "gateway" | "plugin";

/**
 * HTTP route registration parameters.
 */
export type HttpRouteParams = {
  path: string;
  auth: HttpRouteAuth;
  match?: HttpRouteMatch;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean;
};

/**
 * Moltbot plugin API interface for host registration.
 */
export interface MoltbotPluginApi {
  registerChannel: (opts: { plugin: unknown }) => void;
  registerCli?: (
    registrar: (ctx: { program: unknown; config?: PluginConfig }) => void | Promise<void>,
    opts?: { commands?: string[] }
  ) => void;
  registerHttpHandler?: (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean
  ) => void;
  registerHttpRoute?: (params: HttpRouteParams) => void;
  config?: PluginConfig;
  runtime?: unknown;
  [key: string]: unknown;
}
