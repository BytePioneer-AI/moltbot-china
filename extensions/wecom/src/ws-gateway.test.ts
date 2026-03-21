import { once } from "node:events";
import { existsSync, promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

vi.mock("@wecom/aibot-node-sdk", async () => await import("./test-sdk-mock.js"));

import { resetMockSdkBehavior, setMockDisconnectErrorMessage } from "./test-sdk-mock.js";
import { resolveWecomAccount, type PluginConfig } from "./config.js";
import { clearWecomRuntime, setWecomRuntime } from "./runtime.js";
import { WECOM_WS_THINKING_MESSAGE } from "./ws-reply-context.js";
import {
  sendWecomWsProactiveMarkdown,
  startWecomWsGateway,
  stopWecomWsGatewayForAccount,
} from "./ws-gateway.js";
import type { WecomWsFrame } from "./ws-protocol.js";

async function waitFor(condition: () => boolean, timeoutMs: number = 1_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("wecom ws gateway", () => {
  afterEach(() => {
    stopWecomWsGatewayForAccount("default");
    clearWecomRuntime();
    resetMockSdkBehavior();
  });

  it("subscribes, heartbeats, and proactively sends after activation", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    const received: WecomWsFrame[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        received.push(frame);
        if (
          frame.cmd === "aibot_subscribe" ||
          frame.cmd === "aibot_send_msg" ||
          frame.cmd === "aibot_get_mcp_config" ||
          frame.cmd === "ping"
        ) {
          const body =
            frame.cmd === "aibot_get_mcp_config"
              ? {
                  url: "https://doc-mcp.example.test/mcp",
                  type: "streamable-http",
                  is_authed: true,
                }
              : undefined;
          socket.send(
            JSON.stringify({
              cmd: frame.cmd,
              headers: {
                req_id: frame.headers?.req_id,
              },
              errcode: 0,
              body,
            })
          );
        }
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
          reconnectInitialDelayMs: 10,
          reconnectMaxDelayMs: 40,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    const statuses: Array<Record<string, unknown>> = [];
    const controller = new AbortController();

    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: () => {},
      },
      setStatus: (status) => {
        statuses.push(status);
      },
    });

    await waitFor(
      () =>
        received.some((frame) => frame.cmd === "aibot_subscribe") &&
        statuses.some((status) => status.connectionState === "ready")
    );
    await waitFor(() => received.some((frame) => frame.cmd === "ping"));

    const client = [...server.clients][0];
    client?.send(
      JSON.stringify({
        cmd: "aibot_msg_callback",
        headers: {
          req_id: "req-callback-1",
        },
        body: {
          msgid: "msg-1",
          chattype: "single",
          from: { userid: "user-1" },
          msgtype: "text",
          text: { content: "hello" },
        },
      })
    );

    await waitFor(() => statuses.some((status) => typeof status.lastInboundAt === "number"));

    await sendWecomWsProactiveMarkdown({
      accountId: account.accountId,
      to: "user:user-1",
      content: "follow-up",
    });

    await waitFor(() => received.some((frame) => frame.cmd === "aibot_send_msg"));
    expect(received.find((frame) => frame.cmd === "aibot_send_msg")?.body).toEqual({
      chatid: "user-1",
      msgtype: "markdown",
      markdown: {
        content: "follow-up",
      },
    });

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();
    expect(statuses.some((status) => status.running === false)).toBe(true);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("rejects proactive send before the conversation is activated", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        if (frame.cmd === "aibot_subscribe" || frame.cmd === "aibot_get_mcp_config") {
          const body =
            frame.cmd === "aibot_get_mcp_config"
              ? {
                  url: "https://doc-mcp.example.test/mcp",
                  type: "streamable-http",
                  is_authed: true,
                }
              : undefined;
          socket.send(
            JSON.stringify({
              cmd: frame.cmd,
              headers: {
                req_id: frame.headers?.req_id,
              },
              errcode: 0,
              body,
            })
          );
        }
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    const controller = new AbortController();
    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: () => {},
      },
    });

    await waitFor(() => server.clients.size === 1);
    await expect(
      sendWecomWsProactiveMarkdown({
        accountId: account.accountId,
        to: "user:never-seen",
        content: "follow-up",
      })
    ).rejects.toThrow("No activated WeCom ws conversation found");

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("sends a placeholder frame after acceptance and then overwrites it with the real reply", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    const received: WecomWsFrame[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        received.push(frame);
        if (frame.cmd === "aibot_msg_callback" || frame.cmd === "aibot_event_callback") {
          return;
        }
        socket.send(
          JSON.stringify({
            cmd: frame.cmd,
            headers: {
              req_id: frame.headers?.req_id,
            },
            errcode: 0,
          })
        );
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          dmPolicy: "open",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
          reconnectInitialDelayMs: 10,
          reconnectMaxDelayMs: 40,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    setWecomRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: account.accountId,
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            await dispatcherOptions.deliver({
              text: "final answer",
            });
          },
        },
      },
    });

    const controller = new AbortController();
    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: () => {},
      },
    });

    await waitFor(() => received.some((frame) => frame.cmd === "aibot_subscribe"));

    const client = [...server.clients][0];
    client?.send(
      JSON.stringify({
        cmd: "aibot_msg_callback",
        headers: {
          req_id: "req-placeholder-1",
        },
        body: {
          msgid: "msg-placeholder-1",
          chattype: "single",
          from: { userid: "user-1" },
          msgtype: "text",
          text: { content: "hello" },
        },
      })
    );

    await waitFor(() =>
      received.filter((frame) => frame.cmd === "aibot_respond_msg" && frame.body).length >= 2
    );

    const replies = received.filter((frame) => frame.cmd === "aibot_respond_msg");
    expect(replies[0]).toMatchObject({
      headers: { req_id: "req-placeholder-1" },
      body: {
        msgtype: "stream",
        stream: {
          finish: false,
          content: WECOM_WS_THINKING_MESSAGE,
        },
      },
    });
    expect(replies[1]).toMatchObject({
      headers: { req_id: "req-placeholder-1" },
      body: {
        msgtype: "stream",
        stream: {
          finish: false,
          content: "final answer",
        },
      },
    });
    expect(
      (replies[0].body as { stream?: { id?: string } }).stream?.id
    ).toBe(
      (replies[1].body as { stream?: { id?: string } }).stream?.id
    );

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("closes a thinking-only reply without turning the placeholder into visible text", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    const received: WecomWsFrame[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        received.push(frame);
        if (frame.cmd === "aibot_msg_callback" || frame.cmd === "aibot_event_callback") {
          return;
        }
        socket.send(
          JSON.stringify({
            cmd: frame.cmd,
            headers: {
              req_id: frame.headers?.req_id,
            },
            errcode: 0,
          })
        );
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          dmPolicy: "open",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
          reconnectInitialDelayMs: 10,
          reconnectMaxDelayMs: 40,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    setWecomRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: account.accountId,
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: async () => undefined,
        },
      },
    });

    const controller = new AbortController();
    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: () => {},
      },
    });

    await waitFor(() => received.some((frame) => frame.cmd === "aibot_subscribe"));

    const client = [...server.clients][0];
    client?.send(
      JSON.stringify({
        cmd: "aibot_msg_callback",
        headers: {
          req_id: "req-thinking-only-1",
        },
        body: {
          msgid: "msg-thinking-only-1",
          chattype: "single",
          from: { userid: "user-1" },
          msgtype: "text",
          text: { content: "hello" },
        },
      })
    );

    await waitFor(
      () => received.filter((frame) => frame.cmd === "aibot_respond_msg" && frame.body).length >= 2,
      4_000
    );

    const replies = received.filter((frame) => frame.cmd === "aibot_respond_msg");
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({
      headers: { req_id: "req-thinking-only-1" },
      body: {
        msgtype: "stream",
        stream: {
          finish: false,
          content: WECOM_WS_THINKING_MESSAGE,
        },
      },
    });
    expect(replies[1]).toMatchObject({
      headers: { req_id: "req-thinking-only-1" },
      body: {
        msgtype: "stream",
        stream: {
          finish: true,
        },
      },
    });
    expect(((replies[1].body as { stream?: { content?: string } }).stream?.content)).toBeUndefined();

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("does not send a placeholder frame when the message is rejected before dispatch", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    const received: WecomWsFrame[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        received.push(frame);
        if (frame.cmd === "aibot_msg_callback" || frame.cmd === "aibot_event_callback") {
          return;
        }
        socket.send(
          JSON.stringify({
            cmd: frame.cmd,
            headers: {
              req_id: frame.headers?.req_id,
            },
            errcode: 0,
          })
        );
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          dmPolicy: "disabled",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
          reconnectInitialDelayMs: 10,
          reconnectMaxDelayMs: 40,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    setWecomRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: account.accountId,
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }) => {
            await dispatcherOptions.deliver({
              text: "should not happen",
            });
          },
        },
      },
    });

    const controller = new AbortController();
    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: () => {},
      },
    });

    await waitFor(() => received.some((frame) => frame.cmd === "aibot_subscribe"));

    const client = [...server.clients][0];
    client?.send(
      JSON.stringify({
        cmd: "aibot_msg_callback",
        headers: {
          req_id: "req-disabled-1",
        },
        body: {
          msgid: "msg-disabled-1",
          chattype: "single",
          from: { userid: "user-1" },
          msgtype: "text",
          text: { content: "hello" },
        },
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received.filter((frame) => frame.cmd === "aibot_respond_msg")).toHaveLength(0);

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("suppresses expected shutdown ws errors during abort cleanup", async () => {
    setMockDisconnectErrorMessage("Invalid WebSocket frame: invalid opcode 3");

    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        if (!frame.cmd) return;
        socket.send(
          JSON.stringify({
            cmd: frame.cmd,
            headers: {
              req_id: frame.headers?.req_id,
            },
            errcode: 0,
          })
        );
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
          reconnectInitialDelayMs: 10,
          reconnectMaxDelayMs: 40,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    const statuses: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    const controller = new AbortController();
    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: (message) => {
          errors.push(message);
        },
      },
      setStatus: (status) => {
        statuses.push(status);
      },
    });

    await waitFor(() => statuses.some((status) => status.connectionState === "ready"));

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();

    expect(errors).not.toContain(expect.stringContaining("invalid opcode 3"));
    expect(
      statuses.some(
        (status) =>
          status.connectionState === "disconnected" &&
          status.running === false &&
          typeof status.lastDisconnectAt === "number"
      )
    ).toBe(true);
    expect(
      statuses.some(
        (status) => typeof status.lastError === "string" && String(status.lastError).includes("invalid opcode 3")
      )
    ).toBe(false);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("finishes a skipped reply without turning the hidden placeholder into a visible message", async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    const received: WecomWsFrame[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        received.push(frame);
        if (frame.cmd === "aibot_msg_callback" || frame.cmd === "aibot_event_callback") {
          return;
        }
        socket.send(
          JSON.stringify({
            cmd: frame.cmd,
            headers: {
              req_id: frame.headers?.req_id,
            },
            errcode: 0,
          })
        );
      });
    });

    const { port } = server.address() as AddressInfo;
    const cfg: PluginConfig = {
      channels: {
        wecom: {
          mode: "ws",
          dmPolicy: "open",
          botId: "bot-1",
          secret: "secret-1",
          wsUrl: `ws://127.0.0.1:${port}`,
          heartbeatIntervalMs: 20,
          reconnectInitialDelayMs: 10,
          reconnectMaxDelayMs: 40,
        },
      },
    };
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    setWecomRuntime({
      channel: {
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "session-1",
            accountId: account.accountId,
          }),
        },
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: async ({ dispatcherOptions }) => {
            await dispatcherOptions.onSkip?.({}, { kind: "final", reason: "silent" });
          },
        },
      },
    });

    const controller = new AbortController();
    const gatewayPromise = startWecomWsGateway({
      cfg,
      account,
      abortSignal: controller.signal,
      runtime: {
        log: () => {},
        error: () => {},
      },
    });

    await waitFor(() => received.some((frame) => frame.cmd === "aibot_subscribe"));

    const client = [...server.clients][0];
    client?.send(
      JSON.stringify({
        cmd: "aibot_msg_callback",
        headers: {
          req_id: "req-skip-1",
        },
        body: {
          msgid: "msg-skip-1",
          chattype: "single",
          from: { userid: "user-1" },
          msgtype: "text",
          text: { content: "hello" },
        },
      })
    );

    await waitFor(
      () => received.filter((frame) => frame.cmd === "aibot_respond_msg" && frame.body).length >= 2,
      4_000
    );

    const replies = received.filter((frame) => frame.cmd === "aibot_respond_msg");
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({
      headers: { req_id: "req-skip-1" },
      body: {
        msgtype: "stream",
        stream: {
          finish: false,
          content: WECOM_WS_THINKING_MESSAGE,
        },
      },
    });
    expect(replies[1]).toMatchObject({
      headers: { req_id: "req-skip-1" },
      body: {
        msgtype: "stream",
        stream: {
          finish: true,
        },
      },
    });
    expect(((replies[1].body as { stream?: { content?: string } }).stream?.content)).toBeUndefined();

    controller.abort();
    await expect(gatewayPromise).resolves.toBeUndefined();

    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("fetches doc MCP config after ws authentication and saves it under the OpenClaw state dir", async () => {
    const tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "wecom-mcp-state-"));
    const previousOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = tempStateDir;

    const server = new WebSocketServer({ port: 0 });
    await once(server, "listening");

    const received: WecomWsFrame[] = [];
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as WecomWsFrame;
        received.push(frame);
        if (frame.cmd === "aibot_subscribe") {
          socket.send(
            JSON.stringify({
              cmd: frame.cmd,
              headers: {
                req_id: frame.headers?.req_id,
              },
              errcode: 0,
            })
          );
          return;
        }
        if (frame.cmd === "aibot_get_mcp_config") {
          socket.send(
            JSON.stringify({
              cmd: frame.cmd,
              headers: {
                req_id: frame.headers?.req_id,
              },
              errcode: 0,
              body: {
                url: "https://doc-mcp.example.test/mcp",
                type: "streamable-http",
                is_authed: true,
              },
            })
          );
        }
      });
    });

    try {
      const { port } = server.address() as AddressInfo;
      const cfg: PluginConfig = {
        channels: {
          wecom: {
            mode: "ws",
            botId: "bot-1",
            secret: "secret-1",
            wsUrl: `ws://127.0.0.1:${port}`,
            heartbeatIntervalMs: 20,
            reconnectInitialDelayMs: 10,
            reconnectMaxDelayMs: 40,
          },
        },
      };
      const account = resolveWecomAccount({ cfg, accountId: "default" });
      const controller = new AbortController();

      const gatewayPromise = startWecomWsGateway({
        cfg,
        account,
        abortSignal: controller.signal,
        runtime: {
          log: () => {},
          error: () => {},
        },
      });

      const configPath = path.join(tempStateDir, "wecomConfig", "config.json");

      await waitFor(() => received.some((frame) => frame.cmd === "aibot_get_mcp_config"));
      await waitFor(() => existsSync(configPath));

      const saved = JSON.parse(await fs.readFile(configPath, "utf8")) as {
        mcpConfig?: {
          doc?: {
            type?: string;
            url?: string;
          };
        };
        accounts?: Record<
          string,
          {
            isAuthed?: boolean;
            mcpConfig?: {
              doc?: {
                type?: string;
                url?: string;
              };
            };
          }
        >;
      };

      expect(saved.mcpConfig?.doc).toEqual({
        type: "streamable-http",
        url: "https://doc-mcp.example.test/mcp",
      });
      expect(saved.accounts?.default?.isAuthed).toBe(true);
      expect(saved.accounts?.default?.mcpConfig?.doc).toEqual({
        type: "streamable-http",
        url: "https://doc-mcp.example.test/mcp",
      });

      controller.abort();
      await expect(gatewayPromise).resolves.toBeUndefined();
    } finally {
      if (previousOpenClawStateDir === undefined) {
        delete process.env.OPENCLAW_STATE_DIR;
      } else {
        process.env.OPENCLAW_STATE_DIR = previousOpenClawStateDir;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  });
});
