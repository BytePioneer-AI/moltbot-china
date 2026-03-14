/**
 * 企业微信客户渠道类型定义
 */

/** DM 消息策略 */
export type WecomKhDmPolicy = "open" | "pairing" | "allowlist" | "disabled";

/**
 * 企业微信客户账户配置
 * 使用 corpId + khSecret 获取 access_token，openKfId 标识客服账号
 */
export type WecomKhAccountConfig = {
  name?: string;
  enabled?: boolean;

  /** Webhook 路径（接收企微回调） */
  webhookPath?: string;
  /** 回调 Token（用于验签） */
  token?: string;
  /** 回调消息加密密钥 */
  encodingAESKey?: string;
  /** 接收者 ID（用于解密验证，通常为 corpId） */
  receiveId?: string;

  /** 企业 ID */
  corpId?: string;
  /** 微信客服应用 Secret（用于获取 access_token） */
  khSecret?: string;
  /** 客服账号 ID（open_kfid，格式 wkXXX） */
  openKfId?: string;
  /** 兼容旧字段：客服账号 ID（open_kfid，格式 wkXXX） */
  agentId?: string;
  /** 企业微信 API 基础地址（可选，默认 https://qyapi.weixin.qq.com） */
  apiBaseUrl?: string;

  /** 欢迎文本 */
  welcomeText?: string;

  /** DM 策略 */
  dmPolicy?: WecomKhDmPolicy;
  /** DM 允许列表（external_userid） */
  allowFrom?: string[];
};

/**
 * 企业微信客户配置（顶层）
 */
export type WecomKhConfig = WecomKhAccountConfig & {
  accounts?: Record<string, WecomKhAccountConfig>;
  defaultAccount?: string;
};

/**
 * 解析后的企业微信客户账户
 */
export type ResolvedWecomKhAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  /** 回调 Token */
  token?: string;
  /** 回调消息加密密钥 */
  encodingAESKey?: string;
  /** 接收者 ID */
  receiveId: string;
  /** 企业 ID */
  corpId?: string;
  /** 微信客服 Secret */
  khSecret?: string;
  /** 客服账号 ID（open_kfid） */
  openKfId?: string;
  /** 客服账号 ID */
  agentId?: string;
  /** 是否支持收发消息（corpId + khSecret + openKfId 均已配置） */
  canSend: boolean;
  /** 原始账户配置 */
  config: WecomKhAccountConfig;
};

/** 消息发送目标 */
export type WecomKhSendTarget = {
  /** 外部用户 ID（external_userid） */
  externalUserId: string;
  /** 当前会话对应的客服账号 ID（open_kfid） */
  openKfId?: string;
};

/** Access Token 缓存条目 */
export type AccessTokenCacheEntry = {
  token: string;
  expiresAt: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// 入站消息类型（通过 sync_msg 拉取到的消息）
// ─────────────────────────────────────────────────────────────────────────────

/** sync_msg 返回的消息基础字段 */
export type WecomKhInboundBase = {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  send_time?: number;
  /**
   * 消息来源
   * 3: 微信客户发送
   * 4: 系统推送
   * 5: 接待人员在企业微信回复
   */
  origin?: number;
  servicer_userid?: string;
  msgtype?: string;
};

export type WecomKhInboundText = WecomKhInboundBase & {
  msgtype: "text";
  text?: { content?: string; menu_id?: string };
};

export type WecomKhInboundImage = WecomKhInboundBase & {
  msgtype: "image";
  image?: { media_id?: string };
};

export type WecomKhInboundVoice = WecomKhInboundBase & {
  msgtype: "voice";
  voice?: { media_id?: string };
};

export type WecomKhInboundVideo = WecomKhInboundBase & {
  msgtype: "video";
  video?: { media_id?: string };
};

export type WecomKhInboundFile = WecomKhInboundBase & {
  msgtype: "file";
  file?: { media_id?: string };
};

export type WecomKhInboundLocation = WecomKhInboundBase & {
  msgtype: "location";
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
};

export type WecomKhInboundLink = WecomKhInboundBase & {
  msgtype: "link";
  link?: {
    title?: string;
    desc?: string;
    url?: string;
    pic_url?: string;
  };
};

export type WecomKhInboundBusinessCard = WecomKhInboundBase & {
  msgtype: "business_card";
  business_card?: { userid?: string };
};

export type WecomKhInboundMiniprogram = WecomKhInboundBase & {
  msgtype: "miniprogram";
  miniprogram?: {
    title?: string;
    appid?: string;
    pagepath?: string;
    thumb_media_id?: string;
  };
};

/** 事件消息（会话状态变更、接待人员变更等） */
export type WecomKhInboundEvent = WecomKhInboundBase & {
  msgtype: "event";
  event?: {
    event_type?: string;
    open_kfid?: string;
    external_userid?: string;
    scene?: string;
    scene_param?: string;
    welcome_code?: string;
    wechat_channels?: Record<string, unknown>;
    fail_msgid?: string;
    fail_type?: number;
    servicer_userid?: string;
    status?: number;
    change_type?: number;
    old_servicer_userid?: string;
    new_servicer_userid?: string;
    msg_code?: string;
    recall_msgid?: string;
    [key: string]: unknown;
  };
};

export type WecomKhInboundMessage =
  | WecomKhInboundText
  | WecomKhInboundImage
  | WecomKhInboundVoice
  | WecomKhInboundVideo
  | WecomKhInboundFile
  | WecomKhInboundLocation
  | WecomKhInboundLink
  | WecomKhInboundBusinessCard
  | WecomKhInboundMiniprogram
  | WecomKhInboundEvent
  | (WecomKhInboundBase & Record<string, unknown>);

// ─────────────────────────────────────────────────────────────────────────────
// sync_msg 响应
// ─────────────────────────────────────────────────────────────────────────────

export type SyncMsgResponse = {
  errcode?: number;
  errmsg?: string;
  next_cursor?: string;
  has_more?: number;
  msg_list?: WecomKhInboundMessage[];
};
