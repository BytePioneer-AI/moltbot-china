/**
 * 企业微信客户渠道 API - 单元测试
 */
import { describe, it, expect } from "vitest";
import { stripMarkdown, splitMessageByBytes, splitActiveTextChunks } from "../api.js";

describe("api", () => {
  describe("stripMarkdown", () => {
    it("应移除标题标记", () => {
      expect(stripMarkdown("# 标题")).toBe("【标题】");
      expect(stripMarkdown("## 二级标题")).toBe("【二级标题】");
    });

    it("应移除粗体和斜体", () => {
      expect(stripMarkdown("**粗体**")).toBe("粗体");
      expect(stripMarkdown("*斜体*")).toBe("斜体");
    });

    it("应转换代码块", () => {
      const input = "```javascript\nconsole.log('hello');\n```";
      const result = stripMarkdown(input);
      expect(result).toContain("[javascript]");
      expect(result).toContain("console.log('hello');");
    });

    it("应保留链接文字和 URL", () => {
      expect(stripMarkdown("[链接](https://example.com)")).toBe("链接 (https://example.com)");
    });

    it("应转换列表项", () => {
      expect(stripMarkdown("- 第一项\n- 第二项")).toBe("· 第一项\n· 第二项");
    });

    it("应移除行内代码标记", () => {
      expect(stripMarkdown("使用 `command` 命令")).toBe("使用 command 命令");
    });

    it("应移除删除线", () => {
      expect(stripMarkdown("~~删除~~")).toBe("删除");
    });

    it("应处理引用块", () => {
      expect(stripMarkdown("> 引用内容")).toBe("引用内容");
    });
  });

  describe("splitMessageByBytes", () => {
    it("短消息不需要分片", () => {
      const result = splitMessageByBytes("hello", 2048);
      expect(result).toEqual(["hello"]);
    });

    it("超长消息应按字节分片", () => {
      const longText = "测".repeat(700); // 约 2100 字节
      const result = splitMessageByBytes(longText, 2048);
      expect(result.length).toBeGreaterThan(1);
      for (const chunk of result) {
        expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(2048);
      }
    });

    it("空字符串应返回空数组", () => {
      expect(splitMessageByBytes("", 2048)).toEqual([]);
    });
  });

  describe("splitActiveTextChunks", () => {
    it("应去除 Markdown 并分片", () => {
      const result = splitActiveTextChunks("**hello** world");
      expect(result).toEqual(["hello world"]);
    });

    it("空字符串应返回空数组", () => {
      expect(splitActiveTextChunks("")).toEqual([]);
      expect(splitActiveTextChunks("   ")).toEqual([]);
    });
  });
});
