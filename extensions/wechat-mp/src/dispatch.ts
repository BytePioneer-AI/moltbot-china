import { resolveAllowFrom } from "./config.js";
import { updateAccountState } from "./state.js";
import type {
  PluginConfig,
  PluginRuntime,
  ResolvedWechatMpAccount,
  WechatMpInboundCandidate,
} from "./types.js";

function createLogger(opts: { log?: (message: string) => void; error?: (message: string) => void }) {
  return {
    info: (message: string) => (opts.log ?? console.log)(`[wechat-mp] ${message}`),
    warn: (message: string) => (opts.log ?? console.log)(`[wechat-mp] [WARN] ${message}`),
    error: (message: string) => (opts.error ?? console.error)(`[wechat-mp] [ERROR] ${message}`),
  };
}

function isSenderAllowed(account: ResolvedWechatMpAccount, senderId: string): { allowed: boolean; reason?: string } {
  const policy = account.config.dmPolicy ?? "open";
  if (policy === "disabled") {
    return { allowed: false, reason: "dm disabled" };
  }
  if (policy === "allowlist") {
    const allowFrom = resolveAllowFrom(account.config);
    const allowed = allowFrom.includes(senderId.trim().toLowerCase());
    return allowed ? { allowed: true } : { allowed: false, reason: "sender not in allowlist" };
  }
  if (policy === "pairing") {
    const allowFrom = resolveAllowFrom(account.config);
    if (allowFrom.length > 0 && !allowFrom.includes(senderId.trim().toLowerCase())) {
      return { allowed: false, reason: "sender not paired" };
    }
  }
  return { allowed: true };
}

function buildCandidateBody(candidate: WechatMpInboundCandidate): string {
  if (candidate.msgType === "text") {
    return String(candidate.content ?? "").trim();
  }

  const parts = [`[event:${candidate.event ?? "unknown"}]`];
  if (candidate.eventKey) {
    parts.push(`eventKey=${candidate.eventKey}`);
  }
  if (candidate.ticket) {
    parts.push(`ticket=${candidate.ticket}`);
  }
  return parts.join("\n").trim();
}

export async function dispatchWechatMpCandidate(params: {
  cfg: PluginConfig;
  account: ResolvedWechatMpAccount;
  candidate: WechatMpInboundCandidate;
  runtime: PluginRuntime;
  onChunk?: (text: string) => Promise<void>;
  log?: (message: string) => void;
  error?: (message: string) => void;
}): Promise<{ dispatched: boolean; reason?: string; combinedReply?: string }> {
  const logger = createLogger({ log: params.log, error: params.error });
  const { candidate } = params;

  if (!candidate.hasUserIntent) {
    return { dispatched: false, reason: "non-intentful event" };
  }

  const bodyRaw = buildCandidateBody(candidate);
  if (!bodyRaw) {
    return { dispatched: false, reason: "empty inbound body" };
  }

  const policyResult = isSenderAllowed(params.account, candidate.openId);
  if (!policyResult.allowed) {
    logger.info(`skip sender=${candidate.openId} reason=${policyResult.reason ?? "policy rejected"}`);
    return { dispatched: false, reason: policyResult.reason };
  }

  const channel = params.runtime.channel;
  const resolveAgentRoute = channel?.routing?.resolveAgentRoute;
  const dispatchReply = channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (!resolveAgentRoute || !dispatchReply) {
    const message = "runtime routing or buffered reply dispatcher unavailable";
    logger.warn(message);
    await updateAccountState(params.account.accountId, { lastError: message });
    return { dispatched: false, reason: message };
  }

  const route = resolveAgentRoute({
    cfg: params.cfg,
    channel: "wechat-mp",
    accountId: params.account.accountId,
    peer: { kind: "dm", id: candidate.openId },
  });

  const fromLabel = `user:${candidate.openId}`;
  const from = `wechat-mp:${candidate.target}`;
  const to = candidate.target;
  const effectiveSessionKey = route.sessionKey;
  const storePath = channel.session?.resolveStorePath?.(params.cfg.session?.store, {
    agentId: route.agentId,
  });
  const previousTimestamp = storePath
    ? channel.session?.readSessionUpdatedAt?.({
        storePath,
        sessionKey: effectiveSessionKey,
      })
    : null;
  const envelopeOptions = channel.reply?.resolveEnvelopeFormatOptions?.(params.cfg);
  const body = channel.reply?.formatAgentEnvelope
    ? channel.reply.formatAgentEnvelope({
        channel: "WeChat MP",
        from: fromLabel,
        previousTimestamp: previousTimestamp ?? undefined,
        envelope: envelopeOptions,
        body: bodyRaw,
      })
    : bodyRaw;

  const ctxPayload =
    (channel.reply?.finalizeInboundContext?.({
      Body: body,
      RawBody: bodyRaw,
      CommandBody: bodyRaw,
      From: from,
      To: to,
      SessionKey: effectiveSessionKey,
      AccountId: route.accountId ?? params.account.accountId,
      ChatType: "direct",
      ConversationLabel: fromLabel,
      SenderName: candidate.openId,
      SenderId: candidate.openId,
      Provider: "wechat-mp",
      Surface: "wechat-mp",
      MessageSid: candidate.msgId,
      OriginatingChannel: "wechat-mp",
      OriginatingTo: to,
      EventName: candidate.event,
      EventKey: candidate.eventKey,
    }) as Record<string, unknown> | undefined) ?? {
      Body: body,
      RawBody: bodyRaw,
      CommandBody: bodyRaw,
      From: from,
      To: to,
      SessionKey: effectiveSessionKey,
      AccountId: route.accountId ?? params.account.accountId,
      ChatType: "direct",
      ConversationLabel: fromLabel,
      SenderName: candidate.openId,
      SenderId: candidate.openId,
      Provider: "wechat-mp",
      Surface: "wechat-mp",
      MessageSid: candidate.msgId,
      OriginatingChannel: "wechat-mp",
      OriginatingTo: to,
      EventName: candidate.event,
      EventKey: candidate.eventKey,
    };
  ctxPayload.CommandAuthorized = true;

  if (channel.session?.recordInboundSession && storePath) {
    await channel.session.recordInboundSession({
      storePath,
      sessionKey: String(ctxPayload.SessionKey ?? effectiveSessionKey),
      ctx: ctxPayload,
      updateLastRoute: {
        sessionKey: String((route.mainSessionKey ?? effectiveSessionKey) || effectiveSessionKey),
        channel: "wechat-mp",
        to,
        accountId: route.accountId ?? params.account.accountId,
      },
      onRecordError: (error) => {
        logger.error(`recordInboundSession failed: ${String(error)}`);
      },
    });
  }

  const convertTables =
    channel.text?.convertMarkdownTables && channel.text?.resolveMarkdownTableMode
      ? (text: string) =>
          channel.text!.convertMarkdownTables!(
            text,
            channel.text!.resolveMarkdownTableMode!({
              cfg: params.cfg,
              channel: "wechat-mp",
              accountId: params.account.accountId,
            })
          )
      : (text: string) => text;

  const responseChunks: string[] = [];
  await dispatchReply({
    ctx: ctxPayload,
    cfg: params.cfg,
    dispatcherOptions: {
      deliver: async (payload: { text?: string }) => {
        const text = String(payload.text ?? "").trim();
        if (!text) return;
        const convertedText = convertTables(text);
        if (!convertedText) return;
        if (params.onChunk) {
          await params.onChunk(convertedText);
          return;
        }
        responseChunks.push(convertedText);
      },
      onError: (error, info) => {
        logger.error(`${info.kind} reply failed: ${String(error)}`);
      },
    },
  });

  const combinedReply = params.onChunk ? "" : responseChunks.join("\n\n").trim();
  if (combinedReply) {
    await updateAccountState(params.account.accountId, {
      lastOutboundAt: Date.now(),
    });
  }

  return { dispatched: true, combinedReply };
}
