import { type DWClient } from "dingtalk-stream";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { registerDingtalkBotHandler } from "./bot-stream-handler.js";
import { createDingtalkClientFromConfig } from "./client.js";
import type { DingtalkConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";

export interface MonitorDingtalkOpts {
  config?: {
    channels?: {
      dingtalk?: DingtalkConfig;
    };
  };
  runtime?: {
    log?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  abortSignal?: AbortSignal;
  accountId?: string;
  setStatus?: (status: Record<string, unknown>) => void;
}

type DingtalkGatewayState =
  | "idle"
  | "connecting"
  | "connected"
  | "registered"
  | "running"
  | "reconnecting"
  | "stopped";

type ReconnectReason =
  | "connect_error"
  | "connect_timeout"
  | "register_timeout"
  | "connection_lost"
  | "session_error";

type SessionResult = { kind: "stopped" } | { kind: "reconnect"; reason: ReconnectReason };

type GatewayMetrics = {
  connectedSince: number | null;
  lastMessageAt: number | null;
  lastReconnectAt: number | null;
  reconnectCountTotal: number;
  ackFailCount: number;
  dedupeHitCount: number;
  parseErrorCount: number;
  reconnectReasonCount: Record<ReconnectReason, number>;
};

const WATCHDOG_INTERVAL_MS = 5_000;
const CONNECT_TIMEOUT_MS = 30_000;
const REGISTER_TIMEOUT_MS = 30_000;
const DISCONNECT_GRACE_MS = 15_000;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_JITTER_RATIO = 0.2;

let currentClient: DWClient | null = null;
let currentAccountId: string | null = null;
let currentPromise: Promise<void> | null = null;
let currentStop: (() => void) | null = null;

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function ensureGatewayHttpEnabled(params: {
  dingtalkCfg?: DingtalkConfig;
  logger: Logger;
}): Promise<void> {
  const { dingtalkCfg, logger } = params;
  if (!dingtalkCfg?.enableAICard) {
    return;
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, ".openclaw", "openclaw.json"),
    path.join(home, ".openclaw", "config.json"),
  ];

  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }

    try {
      const raw = await fs.readFile(filePath, "utf8");
      const cleaned = raw.replace(/^\uFEFF/, "").trim();
      if (!cleaned) {
        continue;
      }

      const cfg = JSON.parse(cleaned) as Record<string, unknown>;
      const gateway = toRecord(cfg.gateway);
      const http = toRecord(gateway.http);
      const endpoints = toRecord(http.endpoints);
      const chatCompletions = toRecord(endpoints.chatCompletions);

      if (chatCompletions.enabled === true) {
        logger.debug(`[gateway] chatCompletions already enabled in ${filePath}`);
        return;
      }

      chatCompletions.enabled = true;
      endpoints.chatCompletions = chatCompletions;
      http.endpoints = endpoints;
      gateway.http = http;
      cfg.gateway = gateway;

      await fs.writeFile(filePath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
      logger.info(`[gateway] enabled http.endpoints.chatCompletions in ${filePath}`);
      logger.info("[gateway] restart OpenClaw gateway to apply HTTP endpoint change");
      return;
    } catch (err) {
      logger.warn(`[gateway] failed to update ${filePath}: ${String(err)}`);
    }
  }

  logger.warn("[gateway] openclaw config not found; cannot auto-enable http endpoint");
}

function createGatewayMetrics(): GatewayMetrics {
  return {
    connectedSince: null,
    lastMessageAt: null,
    lastReconnectAt: null,
    reconnectCountTotal: 0,
    ackFailCount: 0,
    dedupeHitCount: 0,
    parseErrorCount: 0,
    reconnectReasonCount: {
      connect_error: 0,
      connect_timeout: 0,
      register_timeout: 0,
      connection_lost: 0,
      session_error: 0,
    },
  };
}

function safeDisconnect(client: DWClient, logger: Logger): void {
  try {
    client.disconnect();
  } catch (err) {
    logger.warn(`[gateway] disconnect failed: ${String(err)}`);
  }
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function raceConnectAttempt(params: {
  client: DWClient;
  signal: AbortSignal;
}): Promise<"started" | "timeout" | "aborted" | { error: unknown }> {
  let capturedError: unknown;
  const connectPromise = params.client.connect().then(
    () => "started" as const,
    (err) => {
      capturedError = err;
      return "error" as const;
    },
  );
  const timeoutPromise = sleepWithAbort(CONNECT_TIMEOUT_MS, params.signal).then((running) =>
    running ? ("timeout" as const) : ("aborted" as const),
  );
  const winner = await Promise.race([connectPromise, timeoutPromise]);
  if (winner === "error") {
    return { error: capturedError };
  }
  return winner;
}

type TransitionRef = { state: DingtalkGatewayState };

function transitionState(params: {
  ref: TransitionRef;
  next: DingtalkGatewayState;
  logger: Logger;
  reason?: string;
}): void {
  if (params.ref.state === params.next) {
    return;
  }
  const prev = params.ref.state;
  params.ref.state = params.next;
  const suffix = params.reason ? ` reason=${params.reason}` : "";
  params.logger.info(`[gateway] state ${prev} -> ${params.next}${suffix}`);
}

export function resolveReconnectDelayMs(attempt: number, randomValue = Math.random()): number {
  const safeAttempt = Math.max(1, attempt);
  const expoBase = RECONNECT_BASE_DELAY_MS * 2 ** (safeAttempt - 1);
  const boundedBase = Math.min(RECONNECT_MAX_DELAY_MS, expoBase);
  const normalizedRandom = Math.min(1, Math.max(0, randomValue));
  const jitter = (normalizedRandom * 2 - 1) * RECONNECT_JITTER_RATIO;
  return Math.max(RECONNECT_BASE_DELAY_MS, Math.round(boundedBase * (1 + jitter)));
}

async function runGatewaySession(params: {
  client: DWClient;
  config?: {
    channels?: {
      dingtalk?: DingtalkConfig;
    };
  };
  accountId: string;
  logger: Logger;
  signal: AbortSignal;
  metrics: GatewayMetrics;
  stateRef: TransitionRef;
  setStatus?: (status: Record<string, unknown>) => void;
}): Promise<SessionResult> {
  const { client, config, accountId, logger, signal, metrics, stateRef, setStatus } = params;
  transitionState({ ref: stateRef, next: "connecting", logger });

  let hasInboundTraffic = false;
  let registrationWarningLogged = false;
  registerDingtalkBotHandler({
    client,
    config,
    accountId,
    logger,
    onMessageAccepted: () => {
      hasInboundTraffic = true;
      metrics.lastMessageAt = Date.now();
    },
    onDedupeHit: () => {
      metrics.dedupeHitCount += 1;
    },
    onAckError: () => {
      metrics.ackFailCount += 1;
    },
    onParseError: () => {
      metrics.parseErrorCount += 1;
    },
  });

  const connectAttempt = await raceConnectAttempt({ client, signal });
  if (connectAttempt === "aborted") {
    return { kind: "stopped" };
  }
  if (connectAttempt === "timeout") {
    logger.warn(`[gateway] connect timeout after ${CONNECT_TIMEOUT_MS}ms`);
    return { kind: "reconnect", reason: "connect_timeout" };
  }
  if (typeof connectAttempt === "object" && "error" in connectAttempt) {
    logger.warn(`[gateway] connect error: ${String(connectAttempt.error)}`);
    return { kind: "reconnect", reason: "connect_error" };
  }

  logger.info("Stream client connect invoked");

  const sessionStartAt = Date.now();
  let firstConnectedAt: number | null = null;
  let firstRegisteredAt: number | null = null;
  let disconnectedAt: number | null = null;

  while (true) {
    if (signal.aborted) {
      return { kind: "stopped" };
    }

    const now = Date.now();
    const connected = client.connected === true;
    const registered = client.registered === true;

    if (connected && firstConnectedAt === null) {
      firstConnectedAt = now;
      transitionState({ ref: stateRef, next: "connected", logger });
      logger.info("[gateway] socket connected");
    }
    if (registered && firstRegisteredAt === null) {
      firstRegisteredAt = now;
      metrics.connectedSince = now;
      transitionState({ ref: stateRef, next: "registered", logger });
      transitionState({ ref: stateRef, next: "running", logger });
      logger.info("[gateway] stream registered");
    }

    if (!connected && firstConnectedAt === null && now - sessionStartAt > CONNECT_TIMEOUT_MS) {
      return { kind: "reconnect", reason: "connect_timeout" };
    }
    if (connected && !registered && now - sessionStartAt > REGISTER_TIMEOUT_MS) {
      if (!registrationWarningLogged) {
        registrationWarningLogged = true;
        logger.warn(
          `[gateway] registration not confirmed after ${REGISTER_TIMEOUT_MS}ms; keep connection alive and continue monitoring`,
        );
      }
    }

    if (connected && registered) {
      disconnectedAt = null;
      transitionState({ ref: stateRef, next: "running", logger });
      // 连接正常时更新 lastEventAt，让 OpenClaw 健康检查感知连接存活
      setStatus?.({ lastEventAt: Date.now() });
    } else if (connected && hasInboundTraffic) {
      disconnectedAt = null;
      transitionState({
        ref: stateRef,
        next: "running",
        logger,
        reason: "traffic confirmed",
      });
    } else if (connected) {
      transitionState({ ref: stateRef, next: "connected", logger });
      // 即使未 registered，只要 connected 就上报心跳
      setStatus?.({ lastEventAt: Date.now() });
    } else if (firstConnectedAt !== null) {
      if (disconnectedAt === null) {
        disconnectedAt = now;
        transitionState({
          ref: stateRef,
          next: "reconnecting",
          logger,
          reason: "connection lost",
        });
      } else if (now - disconnectedAt >= DISCONNECT_GRACE_MS) {
        return { kind: "reconnect", reason: "connection_lost" };
      }
    }

    const keepRunning = await sleepWithAbort(WATCHDOG_INTERVAL_MS, signal);
    if (!keepRunning) {
      return { kind: "stopped" };
    }
  }
}

async function runGatewayLoop(params: {
  config?: {
    channels?: {
      dingtalk?: DingtalkConfig;
    };
  };
  dingtalkCfg: DingtalkConfig;
  accountId: string;
  logger: Logger;
  signal: AbortSignal;
  setStatus?: (status: Record<string, unknown>) => void;
}): Promise<void> {
  const { config, dingtalkCfg, accountId, logger, signal, setStatus } = params;
  const metrics = createGatewayMetrics();
  const stateRef: TransitionRef = { state: "idle" };

  let reconnectAttempt = 0;
  while (!signal.aborted) {
    let sessionResult: SessionResult;
    let client: DWClient;

    try {
      client = createDingtalkClientFromConfig(dingtalkCfg, {
        keepAlive: true,
        autoReconnect: false,
        reuseCache: false,
      });
    } catch (err) {
      logger.error(`[gateway] fatal client init error: ${String(err)}`);
      throw err;
    }

    currentClient = client;
    try {
      sessionResult = await runGatewaySession({
        client,
        config,
        accountId,
        logger,
        signal,
        metrics,
        stateRef,
        setStatus,
      });
    } catch (err) {
      logger.error(`[gateway] fatal session error: ${String(err)}`);
      sessionResult = { kind: "reconnect", reason: "session_error" };
    } finally {
      safeDisconnect(client, logger);
      if (currentClient === client) {
        currentClient = null;
      }
    }

    if (sessionResult.kind === "stopped" || signal.aborted) {
      break;
    }

    reconnectAttempt += 1;
    metrics.reconnectCountTotal += 1;
    metrics.lastReconnectAt = Date.now();
    metrics.reconnectReasonCount[sessionResult.reason] += 1;

    transitionState({
      ref: stateRef,
      next: "reconnecting",
      logger,
      reason: sessionResult.reason,
    });

    const delayMs = resolveReconnectDelayMs(reconnectAttempt);
    logger.warn(
      `[gateway] reconnect scheduled in ${delayMs}ms (attempt=${reconnectAttempt}, reason=${sessionResult.reason})`,
    );
    const keepRunning = await sleepWithAbort(delayMs, signal);
    if (!keepRunning) {
      break;
    }
  }

  transitionState({ ref: stateRef, next: "stopped", logger, reason: "abort/stop" });
  logger.info(
    `[gateway] stopped; reconnects=${metrics.reconnectCountTotal} ackFail=${metrics.ackFailCount} dedupeHit=${metrics.dedupeHitCount} parseErr=${metrics.parseErrorCount}`,
  );
}

export async function monitorDingtalkProvider(opts: MonitorDingtalkOpts = {}): Promise<void> {
  const { config, runtime, abortSignal, accountId = "default", setStatus } = opts;
  const logger: Logger = createLogger("dingtalk", {
    log: runtime?.log,
    error: runtime?.error,
  });

  if (currentPromise) {
    if (currentAccountId && currentAccountId !== accountId) {
      throw new Error(`DingTalk already running for account ${currentAccountId}`);
    }
    logger.debug(`existing gateway for account ${accountId} is active, reusing promise`);
    return currentPromise;
  }

  const dingtalkCfg = config?.channels?.dingtalk;
  if (!dingtalkCfg) {
    throw new Error("DingTalk configuration not found");
  }

  await ensureGatewayHttpEnabled({ dingtalkCfg, logger });

  const stopController = new AbortController();
  const stopSignal = stopController.signal;

  const onAbort = () => {
    stopController.abort();
  };

  if (abortSignal?.aborted) {
    stopController.abort();
  } else {
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  }

  currentAccountId = accountId;
  currentStop = () => {
    logger.info("stop requested, stopping Stream gateway");
    stopController.abort();
  };

  const runPromise = runGatewayLoop({
    config,
    dingtalkCfg,
    accountId,
    logger,
    signal: stopSignal,
    setStatus,
  }).finally(() => {
    abortSignal?.removeEventListener("abort", onAbort);
    if (currentPromise === runPromise) {
      currentClient = null;
      currentAccountId = null;
      currentStop = null;
      currentPromise = null;
    }
  });

  currentPromise = runPromise;
  return runPromise;
}

export function stopDingtalkMonitor(): void {
  if (currentStop) {
    currentStop();
    return;
  }
  if (currentClient) {
    const logger = createLogger("dingtalk");
    safeDisconnect(currentClient, logger);
    currentClient = null;
    currentAccountId = null;
    currentPromise = null;
    currentStop = null;
  }
}

export function isMonitorActive(): boolean {
  return currentPromise !== null;
}

export function getCurrentAccountId(): string | null {
  return currentAccountId;
}
