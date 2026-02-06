import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { computeWecomAppMsgSignature, encryptWecomAppPlaintext } from "./crypto.js";
import { handleWecomAppWebhookRequest, registerWecomAppWebhookTarget } from "./monitor.js";
import type { ResolvedWecomAppAccount } from "./types.js";

const token = "token123";
const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

function createRequest(method: string, url: string, body?: string): IncomingMessage {
  const stream = new Readable({
    read() {
      return;
    },
  });
  if (body) {
    stream.push(body);
  }
  stream.push(null);
  (stream as IncomingMessage).method = method;
  (stream as IncomingMessage).url = url;
  return stream as IncomingMessage;
}

function createResponseRecorder() {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    end: (data?: string | Buffer) => {
      if (data === undefined) return;
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
    },
  } as unknown as ServerResponse;

  return {
    res,
    headers,
    getBody: () => Buffer.concat(chunks).toString("utf8"),
  };
}

function buildAccount(params: {
  accountId: string;
  agentId?: number;
  receiveId: string;
}): ResolvedWecomAppAccount {
  return {
    accountId: params.accountId,
    enabled: true,
    configured: true,
    token,
    encodingAESKey,
    receiveId: params.receiveId,
    agentId: params.agentId,
    canSendActive: false,
    config: {
      webhookPath: "/wecom-app",
      agentId: params.agentId,
    },
  };
}

describe("wecom-app webhook routing", () => {
  it("selects account by AgentID when multiple signatures match", async () => {
    const selected: string[] = [];
    const unregisterA = registerWecomAppWebhookTarget({
      account: buildAccount({ accountId: "app", agentId: 1001, receiveId: "corp123" }),
      config: { channels: { "wecom-app": {} } },
      runtime: {},
      path: "/wecom-app",
      statusSink: () => selected.push("app"),
    });

    const unregisterB = registerWecomAppWebhookTarget({
      account: buildAccount({ accountId: "app1", agentId: 2002, receiveId: "corp123" }),
      config: { channels: { "wecom-app": {} } },
      runtime: {},
      path: "/wecom-app",
      statusSink: () => selected.push("app1"),
    });

    const message = {
      msgtype: "text",
      msgid: "m1",
      from: { userid: "user1" },
      text: { content: "hi" },
      AgentID: 2002,
    };

    const encrypt = encryptWecomAppPlaintext({
      encodingAESKey,
      receiveId: "corp123",
      plaintext: JSON.stringify(message),
    });

    const timestamp = "1700000001";
    const nonce = "nonce1";
    const signature = computeWecomAppMsgSignature({
      token,
      timestamp,
      nonce,
      encrypt,
    });

    const params = new URLSearchParams({
      timestamp,
      nonce,
      msg_signature: signature,
    });

    const req = createRequest("POST", `/wecom-app?${params.toString()}`, JSON.stringify({ encrypt }));
    const recorder = createResponseRecorder();

    const handled = await handleWecomAppWebhookRequest(req, recorder.res);

    expect(handled).toBe(true);
    expect(selected).toEqual(["app1"]);

    unregisterA();
    unregisterB();
  });

  it("selects account by receiveId when multiple signatures match", async () => {
    const selected: string[] = [];
    const unregisterA = registerWecomAppWebhookTarget({
      account: buildAccount({ accountId: "app", agentId: 1001, receiveId: "corpA" }),
      config: { channels: { "wecom-app": {} } },
      runtime: {},
      path: "/wecom-app",
      statusSink: () => selected.push("app"),
    });

    const unregisterB = registerWecomAppWebhookTarget({
      account: buildAccount({ accountId: "app1", agentId: 2002, receiveId: "corpB" }),
      config: { channels: { "wecom-app": {} } },
      runtime: {},
      path: "/wecom-app",
      statusSink: () => selected.push("app1"),
    });

    const message = {
      msgtype: "text",
      msgid: "m2",
      from: { userid: "user2" },
      text: { content: "hello" },
    };

    const encrypt = encryptWecomAppPlaintext({
      encodingAESKey,
      receiveId: "corpB",
      plaintext: JSON.stringify(message),
    });

    const timestamp = "1700000002";
    const nonce = "nonce2";
    const signature = computeWecomAppMsgSignature({
      token,
      timestamp,
      nonce,
      encrypt,
    });

    const params = new URLSearchParams({
      timestamp,
      nonce,
      msg_signature: signature,
    });

    const req = createRequest("POST", `/wecom-app?${params.toString()}`, JSON.stringify({ encrypt }));
    const recorder = createResponseRecorder();

    const handled = await handleWecomAppWebhookRequest(req, recorder.res);

    expect(handled).toBe(true);
    expect(selected).toEqual(["app1"]);

    unregisterA();
    unregisterB();
  });
});
