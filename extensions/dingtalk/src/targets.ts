type DingtalkChatType = "direct" | "group";

type ParsedDingtalkTarget = {
  normalized: string;
  targetId: string;
  chatType: DingtalkChatType;
};

function stripProviderPrefix(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.replace(/^(dingtalk|ding):/i, "").trim();
}

function normalizePrefixedTarget(
  raw: string,
  prefix: "user" | "group" | "channel" | "chat",
): string | undefined {
  if (!raw.toLowerCase().startsWith(`${prefix}:`)) {
    return undefined;
  }
  const targetId = raw.slice(prefix.length + 1).trim();
  if (!targetId) {
    return undefined;
  }
  return prefix === "user" ? `user:${targetId}` : `group:${targetId}`;
}

export function normalizeDingtalkMessagingTarget(raw: string): string | undefined {
  const withoutProvider = stripProviderPrefix(raw);
  if (!withoutProvider) {
    return undefined;
  }

  const prefixedTarget =
    normalizePrefixedTarget(withoutProvider, "user") ??
    normalizePrefixedTarget(withoutProvider, "group") ??
    normalizePrefixedTarget(withoutProvider, "channel") ??
    normalizePrefixedTarget(withoutProvider, "chat");
  if (prefixedTarget) {
    return prefixedTarget;
  }

  if (withoutProvider.startsWith("@")) {
    const userId = withoutProvider.slice(1).trim();
    return userId ? `user:${userId}` : undefined;
  }

  if (withoutProvider.startsWith("#")) {
    const groupId = withoutProvider.slice(1).trim();
    return groupId ? `group:${groupId}` : undefined;
  }

  return `user:${withoutProvider}`;
}

export function parseDingtalkSendTarget(raw: string): ParsedDingtalkTarget | null {
  const normalized = normalizeDingtalkMessagingTarget(raw);
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("group:")) {
    return {
      normalized,
      targetId: normalized.slice("group:".length),
      chatType: "group",
    };
  }

  return {
    normalized,
    targetId: normalized.slice("user:".length),
    chatType: "direct",
  };
}

export function looksLikeDingtalkTarget(raw: string, normalized?: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(dingtalk|ding):(user|group|channel|chat):/i.test(trimmed)) {
    return true;
  }

  if (/^(user|group|channel|chat):/i.test(trimmed) || /^[@#]/.test(trimmed)) {
    return true;
  }

  const resolved = normalized ?? normalizeDingtalkMessagingTarget(trimmed);
  if (!resolved) {
    return false;
  }

  const candidate = resolved.replace(/^(user|group):/i, "").trim();
  return candidate.length > 0 && !/\s/.test(candidate);
}

export function inferDingtalkTargetChatType(raw: string): DingtalkChatType | undefined {
  return parseDingtalkSendTarget(raw)?.chatType;
}

export function formatDingtalkTargetDisplay(params: {
  target: string;
  display?: string;
}): string {
  const parsed = parseDingtalkSendTarget(params.target);
  if (!parsed) {
    return params.display?.trim() || params.target;
  }

  const display = params.display?.trim();
  if (display) {
    if (display.startsWith("@") || display.startsWith("#")) {
      return display;
    }
    return parsed.chatType === "group" ? `#${display}` : `@${display}`;
  }

  return parsed.normalized;
}

export function buildDingtalkConversationTarget(
  chatType: DingtalkChatType,
  targetId: string,
): string {
  return chatType === "group" ? `group:${targetId}` : `user:${targetId}`;
}
