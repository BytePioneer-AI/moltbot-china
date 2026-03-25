import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./send.js", () => ({
  sendMessageDingtalk: vi.fn(async () => ({
    messageId: "msg-1",
    conversationId: "conv-1",
  })),
}));

vi.mock("./media.js", () => ({
  sendMediaDingtalk: vi.fn(async () => ({
    messageId: "media-1",
    conversationId: "conv-1",
  })),
}));

import { dingtalkMessageActions } from "./actions.js";
import { sendMessageDingtalk } from "./send.js";
import { sendMediaDingtalk } from "./media.js";

afterEach(() => {
  vi.clearAllMocks();
});

function createActionContext(params: {
  action?: "send" | "sendAttachment";
  to: string;
  message?: string;
  caption?: string;
  media?: string;
  buffer?: string;
  filename?: string;
  contentType?: string;
}) {
  const { action = "send", ...toolParams } = params;
  return {
    channel: "dingtalk" as const,
    action,
    params: toolParams,
    cfg: {
      channels: {
        dingtalk: {
          enabled: true,
          clientId: "ding-app-id",
          clientSecret: "ding-app-secret",
        },
      },
    },
  };
}

describe("dingtalk message actions", () => {
  it("describes the shared send action when dingtalk is configured", () => {
    const discovery = dingtalkMessageActions.describeMessageTool({
      cfg: {
        channels: {
          dingtalk: {
            enabled: true,
            clientId: "ding-app-id",
            clientSecret: "ding-app-secret",
          },
        },
      },
    });

    expect(discovery).toEqual({
      actions: ["send", "sendAttachment"],
      capabilities: [],
    });
  });

  it("returns no discovery when no dingtalk account is configured", () => {
    const discovery = dingtalkMessageActions.describeMessageTool({
      cfg: {
        channels: {
          dingtalk: {
            enabled: true,
          },
        },
      },
    });

    expect(discovery).toBeNull();
  });

  it("dispatches text sends through the shared message action", async () => {
    await dingtalkMessageActions.handleAction?.(
      createActionContext({
        to: "user:user-a",
        message: "hello",
      }),
    );

    expect(sendMessageDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "user-a",
      text: "hello",
      chatType: "direct",
    });
  });

  it("dispatches media sends when media input is provided", async () => {
    await dingtalkMessageActions.handleAction?.(
      createActionContext({
        to: "group:group-1",
        message: "hello",
        media: "https://example.com/file.png",
      }),
    );

    expect(sendMediaDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "group-1",
      mediaUrl: "https://example.com/file.png",
      chatType: "group",
    });
    expect(sendMessageDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "group-1",
      text: "hello",
      chatType: "group",
    });
  });

  it("keeps legacy chat targets compatible by normalizing them to group sends", async () => {
    await dingtalkMessageActions.handleAction?.(
      createActionContext({
        to: "chat:group-legacy",
        message: "hello",
      }),
    );

    expect(sendMessageDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "group-legacy",
      text: "hello",
      chatType: "group",
    });
  });

  it("dispatches sendAttachment using hydrated buffer payloads", async () => {
    const buffer = Buffer.from("fake-image").toString("base64");

    await dingtalkMessageActions.handleAction?.(
      createActionContext({
        action: "sendAttachment",
        to: "user:user-a",
        caption: "see attachment",
        buffer,
        filename: "image.png",
        contentType: "image/png",
      }),
    );

    expect(sendMessageDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "user-a",
      text: "see attachment",
      chatType: "direct",
    });
    expect(sendMediaDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "user-a",
      mediaBuffer: Buffer.from("fake-image"),
      fileName: "image.png",
      contentType: "image/png",
      chatType: "direct",
    });
  });
});
