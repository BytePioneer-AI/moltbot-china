import {
  buildEncryptedReplyXml,
  buildPlainReplyXml,
  computeMsgSignature,
  encryptWechatMpMessage,
} from "./crypto.js";
import { sendWechatMpMessage } from "./api.js";
import type {
  ResolvedWechatMpAccount,
  WechatMpActiveDeliveryMode,
  WechatMpReplyMode,
} from "./types.js";

export type PassiveReplyResult = {
  ok: boolean;
  body?: string;
  error?: string;
};

export type ActiveSendResult = {
  ok: boolean;
  msgid?: string;
  error?: string;
};

export function buildPassiveTextReply(params: {
  account: ResolvedWechatMpAccount;
  toUserName: string;
  fromUserName: string;
  content: string;
  timestamp?: string;
  nonce?: string;
}): PassiveReplyResult {
  const content = params.content.trim();
  if (!content) {
    return { ok: false, error: "empty passive reply content" };
  }

  const createTime = Number(params.timestamp ?? Math.floor(Date.now() / 1000));
  const plainXml = buildPlainReplyXml({
    toUserName: params.toUserName,
    fromUserName: params.fromUserName,
    createTime,
    msgType: "text",
    content,
  });

  if (params.account.config.messageMode === "plain" || !params.account.config.encodingAESKey) {
    return { ok: true, body: plainXml };
  }

  if (!params.account.config.appId || !params.account.config.token) {
    return { ok: false, error: "missing appId or token for encrypted passive reply" };
  }

  try {
    const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = params.nonce ?? Math.random().toString(36).slice(2, 10);
    const encrypted = encryptWechatMpMessage({
      encodingAESKey: params.account.config.encodingAESKey,
      appId: params.account.config.appId,
      plaintext: plainXml,
    }).encrypt;
    const signature = computeMsgSignature({
      token: params.account.config.token,
      timestamp,
      nonce,
      encrypt: encrypted,
    });
    return {
      ok: true,
      body: buildEncryptedReplyXml({
        encrypt: encrypted,
        signature,
        timestamp,
        nonce,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function sendWechatMpActiveText(params: {
  account: ResolvedWechatMpAccount;
  toUserName: string;
  text: string;
}): Promise<ActiveSendResult> {
  if (!params.account.canSendActive) {
    return {
      ok: false,
      error: "Account not configured for active sending (missing appId/appSecret)",
    };
  }

  try {
    const result = await sendWechatMpMessage(params.account, {
      touser: params.toUserName,
      msgtype: "text",
      text: { content: params.text },
    });
    return {
      ok: result.errcode === 0,
      msgid: result.msgid ? String(result.msgid) : undefined,
      error: result.errcode === 0 ? undefined : result.errmsg,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveReplyMode(account: ResolvedWechatMpAccount): WechatMpReplyMode {
  return account.config.replyMode ?? "passive";
}

export function resolveActiveDeliveryMode(account: ResolvedWechatMpAccount): WechatMpActiveDeliveryMode {
  return account.config.activeDeliveryMode ?? "split";
}
