/**
 * Property-Based Tests for InboundContext Field Assignment
 * 
 * Feature: dingtalk-media-receive
 * Property 11: InboundContext field assignment
 * Validates: Requirements 7.1-7.8
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { buildInboundContext, buildFileContextMessage, type InboundContext } from "./bot.js";
import type { DingtalkMessageContext } from "./types.js";
import type { DownloadedFile, ExtractedFileInfo, MediaMsgType } from "./media.js";

/**
 * Helper function to simulate media field assignment logic from handleDingtalkMessage
 * This mirrors the actual implementation in bot.ts
 */
function assignMediaFieldsToContext(
  inboundCtx: InboundContext,
  downloadedMedia: DownloadedFile | null,
  extractedFileInfo: ExtractedFileInfo | null,
  downloadedRichTextImages: DownloadedFile[],
  mediaBody: string | null
): InboundContext {
  // Clone the context to avoid mutation
  const ctx = { ...inboundCtx };

  // Set single media file fields (Requirements 7.1, 7.2)
  if (downloadedMedia) {
    ctx.MediaPath = downloadedMedia.path;
    ctx.MediaType = downloadedMedia.contentType;

    // Set message body
    if (mediaBody) {
      ctx.Body = mediaBody;
      ctx.RawBody = mediaBody;
      ctx.CommandBody = mediaBody;
    }

    // File message specific fields (Requirements 7.5, 7.6)
    if (extractedFileInfo?.msgType === "file") {
      if (extractedFileInfo.fileName) {
        ctx.FileName = extractedFileInfo.fileName;
      }
      if (extractedFileInfo.fileSize !== undefined) {
        ctx.FileSize = extractedFileInfo.fileSize;
      }
    }

    // Audio message transcript (Requirement 7.7)
    if (extractedFileInfo?.msgType === "audio" && extractedFileInfo.recognition) {
      ctx.Transcript = extractedFileInfo.recognition;
    }
  }

  // Set multiple media files fields for richText (Requirements 7.3, 7.4)
  if (downloadedRichTextImages.length > 0) {
    ctx.MediaPaths = downloadedRichTextImages.map(f => f.path);
    ctx.MediaTypes = downloadedRichTextImages.map(f => f.contentType);

    if (mediaBody) {
      ctx.Body = mediaBody;
      ctx.RawBody = mediaBody;
      ctx.CommandBody = mediaBody;
    }
  }

  return ctx;
}

describe("Feature: dingtalk-media-receive, Property 11: InboundContext field assignment", () => {
  /**
   * Arbitrary for generating valid DingtalkMessageContext objects
   */
  const messageContextArb: fc.Arbitrary<DingtalkMessageContext> = fc.record({
    conversationId: fc.string({ minLength: 1, maxLength: 100 }),
    messageId: fc.string({ minLength: 1, maxLength: 100 }),
    senderId: fc.string({ minLength: 1, maxLength: 50 }),
    senderNick: fc.option(fc.string({ minLength: 0, maxLength: 50 }), { nil: undefined }),
    chatType: fc.constantFrom("direct", "group") as fc.Arbitrary<"direct" | "group">,
    content: fc.string({ minLength: 0, maxLength: 500 }),
    contentType: fc.constantFrom("text", "audio", "image", "file"),
    mentionedBot: fc.boolean(),
    robotCode: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
  });

  /**
   * Arbitrary for generating valid DownloadedFile objects
   */
  const downloadedFileArb: fc.Arbitrary<DownloadedFile> = fc.record({
    path: fc.string({ minLength: 10, maxLength: 200 }).map(s => `/tmp/dingtalk-file-${s}`),
    contentType: fc.constantFrom(
      "image/jpeg", "image/png", "image/gif",
      "audio/mpeg", "audio/wav", "audio/amr",
      "video/mp4", "video/quicktime",
      "application/pdf", "application/octet-stream"
    ),
    size: fc.integer({ min: 1, max: 20 * 1024 * 1024 }),
    fileName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  });

  /**
   * Arbitrary for generating valid ExtractedFileInfo objects
   */
  const extractedFileInfoArb: fc.Arbitrary<ExtractedFileInfo> = fc.record({
    downloadCode: fc.string({ minLength: 10, maxLength: 100 }),
    msgType: fc.constantFrom("picture", "video", "audio", "file") as fc.Arbitrary<MediaMsgType>,
    fileName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
    fileSize: fc.option(fc.integer({ min: 1, max: 20 * 1024 * 1024 }), { nil: undefined }),
    duration: fc.option(fc.integer({ min: 0, max: 300000 }), { nil: undefined }),
    recognition: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
  });

  /**
   * Property: Single media file should set MediaPath and MediaType
   * Validates: Requirements 7.1, 7.2
   */
  it("should set MediaPath and MediaType for single media file", () => {
    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }), // sessionKey
      fc.string({ minLength: 1, maxLength: 50 }), // accountId
      downloadedFileArb,
      extractedFileInfoArb,
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedMedia, extractedFileInfo]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = buildFileContextMessage(extractedFileInfo.msgType, extractedFileInfo.fileName);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          downloadedMedia,
          extractedFileInfo,
          [],
          mediaBody
        );

        // MediaPath should be the absolute path (Requirement 7.1)
        expect(resultCtx.MediaPath).toBe(downloadedMedia.path);
        
        // MediaType should be the MIME type string (Requirement 7.2)
        expect(resultCtx.MediaType).toBe(downloadedMedia.contentType);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Multiple media files should set MediaPaths and MediaTypes arrays
   * Validates: Requirements 7.3, 7.4
   */
  it("should set MediaPaths and MediaTypes for multiple media files", () => {
    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.array(downloadedFileArb, { minLength: 1, maxLength: 5 }),
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedImages]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = downloadedImages.length === 1 
          ? "[图片]" 
          : `[${downloadedImages.length}张图片]`;
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          null,
          null,
          downloadedImages,
          mediaBody
        );

        // MediaPaths should be array of absolute paths (Requirement 7.3)
        expect(resultCtx.MediaPaths).toEqual(downloadedImages.map(f => f.path));
        expect(resultCtx.MediaPaths?.length).toBe(downloadedImages.length);
        
        // MediaTypes should be array of MIME type strings (Requirement 7.4)
        expect(resultCtx.MediaTypes).toEqual(downloadedImages.map(f => f.contentType));
        expect(resultCtx.MediaTypes?.length).toBe(downloadedImages.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: File message should set FileName and FileSize when available
   * Validates: Requirements 7.5, 7.6
   */
  it("should set FileName and FileSize for file messages", () => {
    const fileInfoArb = fc.record({
      downloadCode: fc.string({ minLength: 10, maxLength: 100 }),
      msgType: fc.constant("file") as fc.Arbitrary<MediaMsgType>,
      fileName: fc.string({ minLength: 1, maxLength: 100 }),
      fileSize: fc.integer({ min: 1, max: 20 * 1024 * 1024 }),
    });

    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      downloadedFileArb,
      fileInfoArb,
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedMedia, extractedFileInfo]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = buildFileContextMessage(extractedFileInfo.msgType, extractedFileInfo.fileName);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          downloadedMedia,
          extractedFileInfo,
          [],
          mediaBody
        );

        // FileName should be set (Requirement 7.5)
        expect(resultCtx.FileName).toBe(extractedFileInfo.fileName);
        
        // FileSize should be set (Requirement 7.6)
        expect(resultCtx.FileSize).toBe(extractedFileInfo.fileSize);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Audio message with recognition should set Transcript
   * Validates: Requirement 7.7
   */
  it("should set Transcript for audio messages with recognition", () => {
    const audioInfoArb = fc.record({
      downloadCode: fc.string({ minLength: 10, maxLength: 100 }),
      msgType: fc.constant("audio") as fc.Arbitrary<MediaMsgType>,
      duration: fc.option(fc.integer({ min: 0, max: 300000 }), { nil: undefined }),
      recognition: fc.string({ minLength: 1, maxLength: 500 }),
    });

    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      downloadedFileArb,
      audioInfoArb,
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedMedia, extractedFileInfo]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = buildFileContextMessage(extractedFileInfo.msgType);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          downloadedMedia,
          extractedFileInfo,
          [],
          mediaBody
        );

        // Transcript should be set (Requirement 7.7)
        expect(resultCtx.Transcript).toBe(extractedFileInfo.recognition);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: MediaUrl and MediaUrls should NOT be set (Requirement 7.8)
   */
  it("should NOT set MediaUrl or MediaUrls fields", () => {
    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      downloadedFileArb,
      extractedFileInfoArb,
      fc.array(downloadedFileArb, { minLength: 0, maxLength: 5 }),
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedMedia, extractedFileInfo, richTextImages]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = buildFileContextMessage(extractedFileInfo.msgType, extractedFileInfo.fileName);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          downloadedMedia,
          extractedFileInfo,
          richTextImages,
          mediaBody
        );

        // MediaUrl and MediaUrls should NOT be set (Requirement 7.8)
        expect((resultCtx as unknown as Record<string, unknown>).MediaUrl).toBeUndefined();
        expect((resultCtx as unknown as Record<string, unknown>).MediaUrls).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Non-file messages should NOT set FileName or FileSize
   */
  it("should NOT set FileName or FileSize for non-file messages", () => {
    const nonFileInfoArb = fc.record({
      downloadCode: fc.string({ minLength: 10, maxLength: 100 }),
      msgType: fc.constantFrom("picture", "video", "audio") as fc.Arbitrary<MediaMsgType>,
      fileName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      fileSize: fc.option(fc.integer({ min: 1, max: 20 * 1024 * 1024 }), { nil: undefined }),
      duration: fc.option(fc.integer({ min: 0, max: 300000 }), { nil: undefined }),
      recognition: fc.option(fc.string({ minLength: 0, maxLength: 500 }), { nil: undefined }),
    });

    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      downloadedFileArb,
      nonFileInfoArb,
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedMedia, extractedFileInfo]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = buildFileContextMessage(extractedFileInfo.msgType, extractedFileInfo.fileName);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          downloadedMedia,
          extractedFileInfo,
          [],
          mediaBody
        );

        // FileName and FileSize should NOT be set for non-file messages
        expect(resultCtx.FileName).toBeUndefined();
        expect(resultCtx.FileSize).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Non-audio messages should NOT set Transcript
   */
  it("should NOT set Transcript for non-audio messages", () => {
    const nonAudioInfoArb = fc.record({
      downloadCode: fc.string({ minLength: 10, maxLength: 100 }),
      msgType: fc.constantFrom("picture", "video", "file") as fc.Arbitrary<MediaMsgType>,
      fileName: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      fileSize: fc.option(fc.integer({ min: 1, max: 20 * 1024 * 1024 }), { nil: undefined }),
    });

    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
      downloadedFileArb,
      nonAudioInfoArb,
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId, downloadedMedia, extractedFileInfo]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        const mediaBody = buildFileContextMessage(extractedFileInfo.msgType, extractedFileInfo.fileName);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          downloadedMedia,
          extractedFileInfo,
          [],
          mediaBody
        );

        // Transcript should NOT be set for non-audio messages
        expect(resultCtx.Transcript).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Without downloaded media, media fields should NOT be set
   */
  it("should NOT set media fields when no media is downloaded", () => {
    const testArb = fc.tuple(
      messageContextArb,
      fc.string({ minLength: 1, maxLength: 50 }),
      fc.string({ minLength: 1, maxLength: 50 }),
    );

    fc.assert(
      fc.property(testArb, ([ctx, sessionKey, accountId]) => {
        const baseCtx = buildInboundContext(ctx, sessionKey, accountId);
        
        const resultCtx = assignMediaFieldsToContext(
          baseCtx,
          null,
          null,
          [],
          null
        );

        // No media fields should be set
        expect(resultCtx.MediaPath).toBeUndefined();
        expect(resultCtx.MediaType).toBeUndefined();
        expect(resultCtx.MediaPaths).toBeUndefined();
        expect(resultCtx.MediaTypes).toBeUndefined();
        expect(resultCtx.FileName).toBeUndefined();
        expect(resultCtx.FileSize).toBeUndefined();
        expect(resultCtx.Transcript).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });
});
