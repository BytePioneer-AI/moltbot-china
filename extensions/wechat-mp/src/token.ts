/**
 * access_token lifecycle management for wechat-mp
 *
 * Provides centralized token caching, proactive refresh, and error handling.
 */

import type { AccessTokenCacheEntry, ResolvedWechatMpAccount } from "./types.js";

// ============================================================================
// Token Cache
// ============================================================================

const ACCESS_TOKEN_CACHE = new Map<string, AccessTokenCacheEntry>();
const TOKEN_REFRESH_TIMERS = new Map<string, NodeJS.Timeout>();
const INVALID_ACCESS_TOKEN_ERRCODES = new Set([40001, 40014, 42001, 42007]);

interface TokenFetchResult {
  token: string;
  expiresIn: number;
}

/**
 * Build cache key for account
 */
function buildCacheKey(account: ResolvedWechatMpAccount): string {
  return `${account.accountId}:${account.config.appId}`;
}

/**
 * Get a cached access_token or fetch a new one.
 * @throws Error if appId/appSecret not configured or API call fails
 */
export async function getAccessToken(account: ResolvedWechatMpAccount): Promise<string> {
  const key = buildCacheKey(account);

  // Check cache first
  const cached = ACCESS_TOKEN_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  // Fetch new token from WeChat API
  const result = await fetchAccessToken(account);

  // Cache token with 5 minutes before expiry buffer
  const bufferMs = 5 * 60 * 1000;
  const expiresInMs = Math.max((result.expiresIn - 300) * 1000, 60 * 1000);

  const entry: AccessTokenCacheEntry = {
    token: result.token,
    expiresAt: Date.now() + expiresInMs,
  };
  ACCESS_TOKEN_CACHE.set(key, entry);

  // Schedule proactive refresh
  scheduleTokenRefresh(account, expiresInMs - bufferMs);

  return result.token;
}

/**
 * Fetch access_token from WeChat API
 */
async function fetchAccessToken(account: ResolvedWechatMpAccount): Promise<TokenFetchResult> {
  if (!account.config.appId || !account.config.appSecret) {
    throw new Error(`appId or appSecret not configured for account ${account.accountId}`);
  }

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", account.config.appId);
  url.searchParams.set("secret", account.config.appSecret);

  const response = await fetch(url.toString());
  const data = (await response.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };

  if (data.errcode !== undefined && data.errcode !== 0) {
    throw new Error(`getAccessToken failed for ${account.accountId}: ${data.errmsg ?? "unknown error"} (errcode=${data.errcode})`);
  }

  if (!data.access_token) {
    throw new Error(`getAccessToken returned empty access_token for ${account.accountId}`);
  }

  return {
    token: data.access_token,
    expiresIn: data.expires_in ?? 7200,
  };
}

/**
 * Clear token cache for an account
 */
export function clearAccessTokenCache(account: ResolvedWechatMpAccount): void {
  const key = buildCacheKey(account);
  ACCESS_TOKEN_CACHE.delete(key);

  // Clear scheduled refresh
  const timer = TOKEN_REFRESH_TIMERS.get(key);
  if (timer) {
    clearTimeout(timer);
    TOKEN_REFRESH_TIMERS.delete(key);
  }
}

/**
 * Clear all token caches
 */
export function clearAllAccessTokenCache(): void {
  ACCESS_TOKEN_CACHE.clear();
  for (const timer of TOKEN_REFRESH_TIMERS.values()) {
    clearTimeout(timer);
  }
  TOKEN_REFRESH_TIMERS.clear();
}

/**
 * Check if a token needs refresh (expires within 5 minutes)
 */
export function shouldRefreshToken(account: ResolvedWechatMpAccount): boolean {
  const key = buildCacheKey(account);
  const cached = ACCESS_TOKEN_CACHE.get(key);
  if (!cached) return false;

  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= cached.expiresAt - bufferMs;
}

/**
 * Get token cache status
 */
export function getTokenCacheStatus(
  account: ResolvedWechatMpAccount
): { cached: boolean; expiresAt?: number; valid?: boolean } {
  const key = buildCacheKey(account);
  const cached = ACCESS_TOKEN_CACHE.get(key);
  if (!cached) {
    return { cached: false };
  }
  return {
    cached: true,
    expiresAt: cached.expiresAt,
    valid: Date.now() < cached.expiresAt,
  };
}

/**
 * Force refresh token (clear cache and fetch new)
 */
export async function refreshToken(account: ResolvedWechatMpAccount): Promise<string> {
  clearAccessTokenCache(account);
  return getAccessToken(account);
}

/**
 * Schedule proactive token refresh
 */
function scheduleTokenRefresh(account: ResolvedWechatMpAccount, delayMs: number): void {
  const key = buildCacheKey(account);

  // Clear existing timer
  const existing = TOKEN_REFRESH_TIMERS.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  if (delayMs <= 0) {
    return;
  }

  const timer = setTimeout(async () => {
    TOKEN_REFRESH_TIMERS.delete(key);
    try {
      await refreshToken(account);
    } catch {
      // Retry with exponential backoff
      scheduleTokenRefresh(account, Math.min(delayMs * 2, 60 * 60 * 1000));
    }
  }, delayMs);

  TOKEN_REFRESH_TIMERS.set(key, timer);
}

/**
 * Check if error code indicates invalid token
 */
export function isInvalidTokenError(errcode: number): boolean {
  return INVALID_ACCESS_TOKEN_ERRCODES.has(errcode);
}
