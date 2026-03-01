import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@openclaw-china/shared";
import {
  evaluateReplyFinalOnlyDelivery,
  sanitizeQQBotOutboundText,
  sendQQBotMediaWithFallback,
} from "./bot.js";

describe("evaluateReplyFinalOnlyDelivery", () => {
  it("allows non-final tool payload when media exists, and suppresses text", () => {
    const decision = evaluateReplyFinalOnlyDelivery({
      replyFinalOnly: true,
      kind: "tool",
      hasMedia: true,
      sanitizedText: "语音说明",
    });
    expect(decision).toEqual({ skipDelivery: false, suppressText: true });
  });

  it("skips non-final text-only payload when replyFinalOnly is enabled", () => {
    const decision = evaluateReplyFinalOnlyDelivery({
      replyFinalOnly: true,
      kind: "tool",
      hasMedia: false,
      sanitizedText: "仅文本",
    });
    expect(decision).toEqual({ skipDelivery: true, suppressText: false });
  });

  it("keeps final event but strips NO_REPLY to empty outbound text", () => {
    const sanitized = sanitizeQQBotOutboundText("NO_REPLY");
    const decision = evaluateReplyFinalOnlyDelivery({
      replyFinalOnly: true,
      kind: "final",
      hasMedia: false,
      sanitizedText: sanitized,
    });
    const textToSend = decision.suppressText ? "" : sanitized;
    expect(decision.skipDelivery).toBe(false);
    expect(textToSend).toBe("");
  });

  it("does not suppress block text when replyFinalOnly is disabled", () => {
    const sanitized = sanitizeQQBotOutboundText("普通文本");
    const decision = evaluateReplyFinalOnlyDelivery({
      replyFinalOnly: false,
      kind: "block",
      hasMedia: false,
      sanitizedText: sanitized,
    });
    const textToSend = decision.suppressText ? "" : sanitized;
    expect(decision).toEqual({ skipDelivery: false, suppressText: false });
    expect(textToSend).toBe("普通文本");
  });
});

describe("sendQQBotMediaWithFallback", () => {
  it("falls back to text when sendMedia fails", async () => {
    const sendMedia = vi.fn().mockResolvedValue({ channel: "qqbot", error: "upload failed" });
    const sendText = vi.fn().mockResolvedValue({ channel: "qqbot", messageId: "m1", timestamp: 1 });
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    await sendQQBotMediaWithFallback({
      qqCfg: {},
      to: "user:123",
      mediaQueue: ["https://example.com/a.mp3"],
      replyToId: "reply-1",
      logger,
      outbound: { sendMedia, sendText },
    });

    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[0]?.text).toContain("https://example.com/a.mp3");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("sendMedia failed"));
  });
});
