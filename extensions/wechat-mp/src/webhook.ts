import type { IncomingMessage, ServerResponse } from "http";

import { decryptWechatMpMessage, parseWechatMpXml, verifyMsgSignature, verifySignature } from "./crypto.js";
import { dispatchWechatMpCandidate } from "./dispatch.js";
import { normalizeWechatMpInbound } from "./inbound.js";
import {
  buildPassiveTextReply,
  resolveActiveDeliveryMode,
  resolveReplyMode,
  sendWechatMpActiveText,
} from "./send.js";
import { markProcessedMessage, updateAccountState } from "./state.js";
import { tryGetWechatMpRuntime } from "./runtime.js";
import { resolveWechatMpAccount } from "./config.js";
import type { PluginConfig, ResolvedWechatMpAccount, WebhookTarget, WechatMpInboundCandidate } from "./types.js";

const WEBHOOK_TARGETS = new Map<string, WebhookTarget[]>();

function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function resolvePath(req: IncomingMessage): string {
  const raw = req.url ?? "/";
  const queryIndex = raw.indexOf("?");
  return normalizeWebhookPath(queryIndex >= 0 ? raw.slice(0, queryIndex) : raw);
}

function resolveQueryParams(req: IncomingMessage): URLSearchParams {
  const raw = req.url ?? "/";
  const queryIndex = raw.indexOf("?");
  return new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : "");
}

async function readRawBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<{ ok: boolean; raw?: string; error?: string }> {
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        resolve({ ok: false, error: "payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ ok: true, raw: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
  });
}

function createLogger(target: WebhookTarget) {
  return {
    info: (message: string) => target.runtime.log(`[wechat-mp] ${message}`),
    warn: (message: string) => target.runtime.log(`[wechat-mp] [WARN] ${message}`),
    error: (message: string) => target.runtime.error(`[wechat-mp] [ERROR] ${message}`),
  };
}

function findTargetByGetSignature(params: {
  targets: WebhookTarget[];
  timestamp: string;
  nonce: string;
  signature: string;
}): WebhookTarget | undefined {
  return params.targets.find((candidate) => {
    const token = candidate.account.config.token?.trim();
    return Boolean(
      token &&
        verifySignature({
          token,
          timestamp: params.timestamp,
          nonce: params.nonce,
          signature: params.signature,
        })
    );
  });
}

function findTargetByPostSignature(params: {
  targets: WebhookTarget[];
  timestamp: string;
  nonce: string;
  encrypt: string;
  msgSignature: string;
}): WebhookTarget | undefined {
  return params.targets.find((candidate) => {
    const token = candidate.account.config.token?.trim();
    return Boolean(
      token &&
        verifyMsgSignature({
          token,
          timestamp: params.timestamp,
          nonce: params.nonce,
          encrypt: params.encrypt,
          msgSignature: params.msgSignature,
        })
    );
  });
}

function parsePostBody(params: {
  raw: string;
  timestamp: string;
  nonce: string;
  msgSignature: string;
}): {
  encrypt?: string;
  effectiveTimestamp: string;
  effectiveNonce: string;
  effectiveMsgSignature: string;
  plaintextXml?: string;
  encrypted: boolean;
} {
  const trimmed = params.raw.trim();
  const isXml = trimmed.startsWith("<");

  if (!isXml) {
    return {
      plaintextXml: params.raw,
      effectiveTimestamp: params.timestamp,
      effectiveNonce: params.nonce,
      effectiveMsgSignature: params.msgSignature,
      encrypted: false,
    };
  }

  const xml = parseWechatMpXml(params.raw);
  const encrypt = xml.Encrypt?.trim();
  if (!encrypt) {
    return {
      plaintextXml: params.raw,
      effectiveTimestamp: params.timestamp,
      effectiveNonce: params.nonce,
      effectiveMsgSignature: params.msgSignature,
      encrypted: false,
    };
  }

  return {
    encrypt,
    effectiveTimestamp: xml.TimeStamp?.trim() || params.timestamp,
    effectiveNonce: xml.Nonce?.trim() || params.nonce,
    effectiveMsgSignature: xml.MsgSignature?.trim() || params.msgSignature,
    encrypted: true,
  };
}

async function recordCandidateState(account: ResolvedWechatMpAccount, candidate: WechatMpInboundCandidate): Promise<void> {
  await updateAccountState(account.accountId, {
    lastInboundAt: Date.now(),
    lastMessageId: candidate.msgId,
    lastEvent: candidate.event,
    lastFromUserName: candidate.openId,
    lastIntentfulAt: candidate.hasUserIntent ? Date.now() : undefined,
  });
}

async function handoffInboundCandidate(
  target: WebhookTarget,
  candidate: WechatMpInboundCandidate
): Promise<{ passiveReplyBody?: string; dispatched: boolean; reason?: string }> {
  const runtime = tryGetWechatMpRuntime();
  const logger = createLogger(target);

  await recordCandidateState(target.account, candidate);

  if (!runtime) {
    logger.warn(`runtime unavailable, skip candidate ${candidate.dedupeKey}`);
    return { dispatched: false, reason: "runtime unavailable" };
  }

  logger.info(
    `inbound accepted msgType=${candidate.msgType} account=${candidate.accountId} from=${candidate.openId} intent=${candidate.hasUserIntent}`
  );

  const replyMode = resolveReplyMode(target.account);
  const activeDeliveryMode = resolveActiveDeliveryMode(target.account);
  const result = await dispatchWechatMpCandidate({
    cfg: target.config,
    account: target.account,
    candidate,
    runtime,
    onChunk:
      replyMode === "active" && activeDeliveryMode === "split"
        ? async (text) => {
            const activeResult = await sendWechatMpActiveText({
              account: target.account,
              toUserName: candidate.openId,
              text,
            });
            if (!activeResult.ok) {
              await updateAccountState(target.account.accountId, {
                lastError: activeResult.error,
              });
              logger.error(`active send failed: ${activeResult.error ?? "unknown error"}`);
            }
          }
        : undefined,
    log: target.runtime.log,
    error: target.runtime.error,
  });

  if (!result.dispatched) {
    if (result.reason) {
      logger.info(`candidate skipped reason=${result.reason}`);
    }
    return { dispatched: false, reason: result.reason };
  }

  const combinedReply = result.combinedReply?.trim();
  if (!combinedReply) {
    return { dispatched: true };
  }

  if (replyMode === "active") {
    const activeResult = await sendWechatMpActiveText({
      account: target.account,
      toUserName: candidate.openId,
      text: combinedReply,
    });
    if (!activeResult.ok) {
      await updateAccountState(target.account.accountId, {
        lastError: activeResult.error,
      });
      logger.error(`active send failed: ${activeResult.error ?? "unknown error"}`);
    }
    return { dispatched: true };
  }

  const passive = buildPassiveTextReply({
    account: target.account,
    toUserName: candidate.openId,
    fromUserName: candidate.toUserName ?? target.account.config.appId ?? "wechat-mp",
    content: combinedReply,
  });
  if (!passive.ok) {
    await updateAccountState(target.account.accountId, {
      lastError: passive.error,
    });
    logger.error(`passive reply build failed: ${passive.error ?? "unknown error"}`);
    return { dispatched: true };
  }

  return { dispatched: true, passiveReplyBody: passive.body };
}

export function registerWechatMpWebhookTarget(target: WebhookTarget): () => void {
  const path = normalizeWebhookPath(target.path);
  const nextTarget = { ...target, path };
  const existing = WEBHOOK_TARGETS.get(path) ?? [];
  WEBHOOK_TARGETS.set(path, [...existing, nextTarget]);
  return () => {
    const updated = (WEBHOOK_TARGETS.get(path) ?? []).filter((entry) => entry !== nextTarget);
    if (updated.length > 0) {
      WEBHOOK_TARGETS.set(path, updated);
    } else {
      WEBHOOK_TARGETS.delete(path);
    }
  };
}

export async function handleWechatMpWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const path = resolvePath(req);
  const targets = WEBHOOK_TARGETS.get(path);
  if (!targets || targets.length === 0) {
    return false;
  }

  const query = resolveQueryParams(req);
  const signature = query.get("signature") ?? "";
  const msgSignature = query.get("msg_signature") ?? signature;
  const timestamp = query.get("timestamp") ?? "";
  const nonce = query.get("nonce") ?? "";

  if (req.method === "GET") {
    const echostr = query.get("echostr") ?? "";
    const encryptType = query.get("encrypt_type") ?? "";
    const hasEncryptedQuery = Boolean(query.get("msg_signature") || encryptType === "aes");
    const target = findTargetByGetSignature({
      targets,
      timestamp,
      nonce,
      signature,
    });

    if (!target || !echostr) {
      res.statusCode = 401;
      res.end("unauthorized");
      return true;
    }

    if (!hasEncryptedQuery) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(echostr);
      return true;
    }

    try {
      const { plaintext } = decryptWechatMpMessage({
        encodingAESKey: target.account.config.encodingAESKey ?? "",
        encrypt: echostr,
        expectedAppId: target.account.config.appId,
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(plaintext);
    } catch (error) {
      res.statusCode = 400;
      res.end(error instanceof Error ? error.message : String(error));
    }
    return true;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    res.end("Method Not Allowed");
    return true;
  }

  const body = await readRawBody(req, 1024 * 1024);
  if (!body.ok || !body.raw) {
    res.statusCode = body.error === "payload too large" ? 413 : 400;
    res.end(body.error ?? "invalid payload");
    return true;
  }

  const parsedBody = parsePostBody({
    raw: body.raw,
    timestamp,
    nonce,
    msgSignature,
  });

  let target: WebhookTarget | undefined;
  let plaintextXml = parsedBody.plaintextXml;

  if (parsedBody.encrypted) {
    target = findTargetByPostSignature({
      targets,
      timestamp: parsedBody.effectiveTimestamp,
      nonce: parsedBody.effectiveNonce,
      encrypt: parsedBody.encrypt ?? "",
      msgSignature: parsedBody.effectiveMsgSignature,
    });

    if (!target) {
      res.statusCode = 401;
      res.end("unauthorized");
      return true;
    }

    try {
      const decrypted = decryptWechatMpMessage({
        encodingAESKey: target.account.config.encodingAESKey ?? "",
        encrypt: parsedBody.encrypt ?? "",
        expectedAppId: target.account.config.appId,
      });
      plaintextXml = decrypted.plaintext;
    } catch (error) {
      await updateAccountState(target.account.accountId, {
        lastError: error instanceof Error ? error.message : String(error),
      });
      res.statusCode = 400;
      res.end("decrypt failed");
      return true;
    }
  } else {
    target = findTargetByGetSignature({
      targets,
      timestamp,
      nonce,
      signature,
    });

    if (!target) {
      res.statusCode = 401;
      res.end("unauthorized");
      return true;
    }
  }

  const xml = parseWechatMpXml(plaintextXml ?? "");
  const messageType = String(xml.MsgType ?? "").trim().toLowerCase();
  const message = xml as unknown as import("./types.js").WechatMpInboundMessage;
  const candidate = normalizeWechatMpInbound({
    account: target.account,
    message,
    encrypted: parsedBody.encrypted,
  });

  if (!candidate) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("success");
    await updateAccountState(target.account.accountId, {
      lastInboundAt: Date.now(),
      lastError: messageType ? undefined : "missing msg type",
      lastEvent: xml.Event?.trim() || undefined,
      lastFromUserName: xml.FromUserName?.trim() || undefined,
    });
    return true;
  }

  const firstSeen = await markProcessedMessage(candidate.dedupeKey);
  if (!firstSeen) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("success");
    return true;
  }

  const handoff = await handoffInboundCandidate(target, candidate);
  if (handoff.passiveReplyBody) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.end(handoff.passiveReplyBody);
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("success");
  return true;
}

export function collectWechatMpWebhookTargets(cfg: PluginConfig): WebhookTarget[] {
  const targets: WebhookTarget[] = [];
  const accountIds = new Set<string>();
  const channelCfg = cfg.channels?.["wechat-mp"];
  if (!channelCfg || typeof channelCfg !== "object") return targets;

  accountIds.add("default");
  const accounts = (channelCfg as { accounts?: Record<string, unknown> }).accounts;
  if (accounts && typeof accounts === "object") {
    for (const accountId of Object.keys(accounts)) {
      accountIds.add(accountId);
    }
  }

  for (const accountId of accountIds) {
    const account = resolveWechatMpAccount({ cfg, accountId });
    const path = (account.config.webhookPath ?? "/wechat-mp").trim() || "/wechat-mp";
    targets.push({
      account,
      config: cfg,
      runtime: {
        log: console.log,
        error: console.error,
      },
      path,
    });
  }

  return targets;
}
