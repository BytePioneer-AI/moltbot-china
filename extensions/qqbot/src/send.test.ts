import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readMedia: vi.fn(),
  getAccessToken: vi.fn(),
  uploadC2CMedia: vi.fn(),
  uploadGroupMedia: vi.fn(),
  sendC2CMediaMessage: vi.fn(),
  sendGroupMediaMessage: vi.fn(),
}));

vi.mock("@openclaw-china/shared", async () => {
  const actual = await vi.importActual<typeof import("@openclaw-china/shared")>(
    "@openclaw-china/shared"
  );
  return {
    ...actual,
    readMedia: mocks.readMedia,
  };
});

vi.mock("./client.js", () => ({
  MediaFileType: {
    IMAGE: 1,
    VIDEO: 2,
    VOICE: 3,
    FILE: 4,
  },
  getAccessToken: mocks.getAccessToken,
  uploadC2CMedia: mocks.uploadC2CMedia,
  uploadGroupMedia: mocks.uploadGroupMedia,
  sendC2CMediaMessage: mocks.sendC2CMediaMessage,
  sendGroupMediaMessage: mocks.sendGroupMediaMessage,
}));

import { HttpError } from "@openclaw-china/shared";
import { sendFileQQBot } from "./send.js";

describe("sendFileQQBot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockResolvedValue("token");
    mocks.uploadGroupMedia.mockResolvedValue({
      file_uuid: "file-1",
      file_info: "file-info-1",
      ttl: 3600,
    });
    mocks.sendGroupMediaMessage.mockResolvedValue({
      id: "msg-1",
      timestamp: 1,
    });
  });

  it("uses URL upload for remote image media", async () => {
    const result = await sendFileQQBot({
      cfg: { appId: "app", clientSecret: "secret" },
      target: { kind: "group", id: "group-1" },
      mediaUrl: "https://example.com/media.png",
      messageId: "reply-1",
    });

    expect(result).toEqual({ id: "msg-1", timestamp: 1 });
    expect(mocks.readMedia).not.toHaveBeenCalled();
    expect(mocks.uploadGroupMedia).toHaveBeenCalledWith({
      accessToken: "token",
      groupOpenid: "group-1",
      fileType: 1,
      url: "https://example.com/media.png",
    });
  });

  it("uses file_data upload for local image media", async () => {
    mocks.readMedia.mockResolvedValue({
      buffer: Buffer.from("hello-image"),
      fileName: "hello.png",
      size: 11,
      mimeType: "image/png",
    });

    await sendFileQQBot({
      cfg: { appId: "app", clientSecret: "secret" },
      target: { kind: "group", id: "group-2" },
      mediaUrl: "C:/tmp/hello.png",
      messageId: "reply-2",
    });

    expect(mocks.readMedia).toHaveBeenCalledTimes(1);
    expect(mocks.uploadGroupMedia).toHaveBeenCalledWith({
      accessToken: "token",
      groupOpenid: "group-2",
      fileType: 1,
      fileData: Buffer.from("hello-image").toString("base64"),
    });
  });

  it("fails fast for generic files like PDF", async () => {
    await expect(
      sendFileQQBot({
        cfg: { appId: "app", clientSecret: "secret" },
        target: { kind: "group", id: "group-3" },
        mediaUrl: "C:/tmp/report.pdf",
      })
    ).rejects.toThrow("file_type=4");

    expect(mocks.readMedia).not.toHaveBeenCalled();
    expect(mocks.uploadGroupMedia).not.toHaveBeenCalled();
  });

  it("includes HTTP response body details in upload errors", async () => {
    mocks.uploadGroupMedia.mockRejectedValue(
      new HttpError(
        "HTTP 500: Internal Server Error",
        500,
        JSON.stringify({ code: 304023, message: "unsupported file type" })
      )
    );

    await expect(
      sendFileQQBot({
        cfg: { appId: "app", clientSecret: "secret" },
        target: { kind: "group", id: "group-4" },
        mediaUrl: "https://example.com/test.jpg",
      })
    ).rejects.toThrow("code=304023");
  });
});
