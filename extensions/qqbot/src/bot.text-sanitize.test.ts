import { describe, expect, it } from "vitest";
import {
  sanitizeQQBotOutboundText,
  shouldSuppressQQBotTextWhenMediaPresent,
} from "./bot.js";

describe("sanitizeQQBotOutboundText", () => {
  it("keeps final content and strips think blocks + emotion tags", () => {
    const input = "<think>internal</think><final>欸，末夕 [chuckles]</final>";
    expect(sanitizeQQBotOutboundText(input)).toBe("欸，末夕");
  });

  it("strips directive tags from tts-style content", () => {
    const input = "[[reply_to_current]] [[tts:text]][playfully] 你好呀 [[/tts:text]]";
    expect(sanitizeQQBotOutboundText(input)).toBe("你好呀");
  });

  it("suppresses NO_REPLY sentinel", () => {
    expect(sanitizeQQBotOutboundText(" NO_REPLY ")).toBe("");
  });
});

describe("shouldSuppressQQBotTextWhenMediaPresent", () => {
  it("suppresses tts echo text when media is present", () => {
    const raw = "[[tts:text]][chuckles] 你好[[/tts:text]]";
    const cleaned = sanitizeQQBotOutboundText(raw);
    expect(shouldSuppressQQBotTextWhenMediaPresent(raw, cleaned)).toBe(true);
  });

  it("keeps normal plain text when media is present", () => {
    const raw = "这是补充说明，请同时查看语音。";
    const cleaned = sanitizeQQBotOutboundText(raw);
    expect(shouldSuppressQQBotTextWhenMediaPresent(raw, cleaned)).toBe(false);
  });
});

