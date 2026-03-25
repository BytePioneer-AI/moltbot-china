import { afterEach, describe, expect, it, vi } from "vitest";

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

import { dingtalkOutbound } from "./outbound.js";
import { sendMediaDingtalk } from "./media.js";
import { sendMessageDingtalk } from "./send.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("dingtalk outbound target routing", () => {
  it("routes canonical group targets through the group send path", async () => {
    await dingtalkOutbound.sendText({
      cfg: {
        channels: {
          dingtalk: {
            enabled: true,
            clientId: "ding-app-id",
            clientSecret: "ding-app-secret",
          },
        },
      },
      to: "group:group-1",
      text: "hello",
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

  it("keeps legacy chat aliases working for outbound media sends", async () => {
    await dingtalkOutbound.sendMedia({
      cfg: {
        channels: {
          dingtalk: {
            enabled: true,
            clientId: "ding-app-id",
            clientSecret: "ding-app-secret",
          },
        },
      },
      to: "chat:group-legacy",
      mediaUrl: "https://example.com/file.png",
    });

    expect(sendMediaDingtalk).toHaveBeenCalledWith({
      cfg: expect.objectContaining({
        clientId: "ding-app-id",
        clientSecret: "ding-app-secret",
      }),
      to: "group-legacy",
      mediaUrl: "https://example.com/file.png",
      chatType: "group",
    });
  });
});
