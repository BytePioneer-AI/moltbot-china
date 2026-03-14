import { describe, expect, it, vi } from "vitest";
import { chunkC2CMarkdownText, looksLikeStructuredMarkdown } from "./bot.js";

describe("looksLikeStructuredMarkdown", () => {
  it("detects headings, tables, quotes, code fences, lists, inline markdown, and multi-paragraph text", () => {
    expect(looksLikeStructuredMarkdown("# 标题")).toBe(true);
    expect(looksLikeStructuredMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe(true);
    expect(looksLikeStructuredMarkdown("> 引用")).toBe(true);
    expect(looksLikeStructuredMarkdown("```ts\nconst answer = 42;\n```")).toBe(true);
    expect(looksLikeStructuredMarkdown("- item")).toBe(true);
    expect(looksLikeStructuredMarkdown("这里有 **加粗** 和 `代码`")).toBe(true);
    expect(looksLikeStructuredMarkdown("第一段\n\n第二段")).toBe(true);
    expect(looksLikeStructuredMarkdown("普通单段文本")).toBe(false);
  });
});

describe("chunkC2CMarkdownText", () => {
  it("keeps headings with the first paragraph when possible", () => {
    const chunks = chunkC2CMarkdownText({
      text: "# 标题\n\n第一段说明。\n\n第二段说明继续。",
      limit: 12,
      strategy: "markdown-block",
    });

    expect(chunks).toEqual(["# 标题\n\n第一段说明。", "第二段说明继续。"]);
  });

  it("does not leave thematic breaks as standalone chunks", () => {
    const chunks = chunkC2CMarkdownText({
      text: "前文说明。\n\n---\n\n后文补充内容。",
      limit: 10,
      strategy: "markdown-block",
    });

    expect(chunks.some((chunk) => chunk.trim() === "---")).toBe(false);
    expect(chunks.some((chunk) => chunk.includes("---"))).toBe(true);
  });

  it("repeats table headers when splitting long tables", () => {
    const table = [
      "| col1 | col2 |",
      "| --- | --- |",
      "| a1 | b1 |",
      "| a2 | b2 |",
      "| a3 | b3 |",
      "| a4 | b4 |",
    ].join("\n");

    const chunks = chunkC2CMarkdownText({
      text: table,
      limit: 48,
      strategy: "markdown-block",
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain("| col1 | col2 |\n| --- | --- |");
    }
  });

  it("keeps fenced code blocks closed after splitting", () => {
    const chunks = chunkC2CMarkdownText({
      text: "```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```",
      limit: 28,
      strategy: "markdown-block",
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith("```ts\n")).toBe(true);
      expect(chunk.endsWith("\n```")).toBe(true);
    }
  });

  it("keeps blockquote prefixes when splitting long quotes", () => {
    const chunks = chunkC2CMarkdownText({
      text: "> 第一行引用内容\n> 第二行引用内容\n> 第三行引用内容",
      limit: 16,
      strategy: "markdown-block",
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.trim()) continue;
        expect(line.startsWith(">")).toBe(true);
      }
    }
  });

  it("avoids splitting common inline markdown markers across chunks", () => {
    const chunks = chunkC2CMarkdownText({
      text: "这是 **加粗内容** 和 `inline-code` 的说明，还有一些补充文字用于触发切分。",
      limit: 32,
      strategy: "markdown-block",
    });

    for (const chunk of chunks) {
      expect((chunk.match(/\*\*/g) ?? []).length % 2).toBe(0);
      expect((chunk.match(/`/g) ?? []).length % 2).toBe(0);
    }
  });

  it("uses the fallback chunker unchanged in length mode", () => {
    const fallbackChunkText = vi.fn((text: string) => [text.slice(0, 4), text.slice(4)]);

    const chunks = chunkC2CMarkdownText({
      text: "# 标题\n\n第一段",
      limit: 8,
      strategy: "length",
      fallbackChunkText,
    });

    expect(fallbackChunkText).toHaveBeenCalledWith("# 标题\n\n第一段");
    expect(chunks).toEqual(["# 标题", "\n\n第一段"]);
  });
});
