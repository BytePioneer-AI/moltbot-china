import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { WechatMpAccountState, WechatMpPersistedState } from "./types.js";

const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEFAULT_STATE_FILE = join(homedir(), ".openclaw", "wechat-mp", "data", "state.json");

let stateFilePath = DEFAULT_STATE_FILE;
let cachedState: WechatMpPersistedState | null = null;
let loadingState: Promise<WechatMpPersistedState> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function createEmptyState(): WechatMpPersistedState {
  return {
    version: 1,
    processedMsgIds: {},
    accounts: {},
  };
}

function pruneState(state: WechatMpPersistedState): void {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [msgId, timestamp] of Object.entries(state.processedMsgIds)) {
    if (timestamp < cutoff) {
      delete state.processedMsgIds[msgId];
    }
  }
}

async function saveState(): Promise<void> {
  if (!cachedState) return;
  pruneState(cachedState);
  await mkdir(dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(cachedState, null, 2)}\n`, "utf8");
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveState();
  }, 50);
}

async function loadState(): Promise<WechatMpPersistedState> {
  if (cachedState) return cachedState;
  if (loadingState) return loadingState;

  loadingState = (async () => {
    try {
      const raw = await readFile(stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<WechatMpPersistedState>;
      cachedState = {
        version: 1,
        processedMsgIds: parsed.processedMsgIds ?? {},
        accounts: parsed.accounts ?? {},
      };
    } catch {
      cachedState = createEmptyState();
    }
    pruneState(cachedState);
    return cachedState;
  })();

  try {
    return await loadingState;
  } finally {
    loadingState = null;
  }
}

export async function markProcessedMessage(msgId: string): Promise<boolean> {
  const normalized = msgId.trim();
  if (!normalized) return false;
  const state = await loadState();
  pruneState(state);
  if (state.processedMsgIds[normalized]) {
    return false;
  }
  state.processedMsgIds[normalized] = Date.now();
  scheduleSave();
  return true;
}

export async function getAccountState(accountId: string): Promise<WechatMpAccountState> {
  const state = await loadState();
  return { ...(state.accounts[accountId] ?? {}) };
}

export async function updateAccountState(
  accountId: string,
  patch: Partial<WechatMpAccountState>
): Promise<WechatMpAccountState> {
  const state = await loadState();
  const current = state.accounts[accountId] ?? {};
  const next = { ...current, ...patch };
  state.accounts[accountId] = next;
  scheduleSave();
  return next;
}

export async function flushWechatMpStateForTests(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await saveState();
}

export function setWechatMpStateFilePathForTests(nextPath?: string): void {
  stateFilePath = nextPath?.trim() || DEFAULT_STATE_FILE;
  cachedState = null;
  loadingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
