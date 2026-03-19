import { describe, expect, it } from "vitest";

import {
  buildWechatMpXml,
  computeMsgSignature,
  computeSignature,
  decryptWechatMpMessage,
  encryptWechatMpMessage,
  parseWechatMpXml,
  verifyMsgSignature,
  verifySignature,
} from "./crypto.js";

const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const appId = "wx-test-appid";

describe("wechat-mp crypto", () => {
  it("verifies callback signatures", () => {
    const signature = computeSignature({
      token: "callback-token",
      timestamp: "1710000000",
      nonce: "nonce-1",
    });

    expect(
      verifySignature({
        token: "callback-token",
        timestamp: "1710000000",
        nonce: "nonce-1",
        signature,
      })
    ).toBe(true);
    expect(
      verifySignature({
        token: "callback-token",
        timestamp: "1710000000",
        nonce: "nonce-1",
        signature: "bad-signature",
      })
    ).toBe(false);
  });

  it("encrypts and decrypts safe-mode payloads", () => {
    const plaintext = buildWechatMpXml({
      ToUserName: appId,
      FromUserName: "openid-1",
      CreateTime: "1710000000",
      MsgType: "text",
      Content: "hello",
      MsgId: "msg-1",
    });
    const encrypted = encryptWechatMpMessage({
      encodingAESKey,
      appId,
      plaintext,
    }).encrypt;

    const decrypted = decryptWechatMpMessage({
      encodingAESKey,
      encrypt: encrypted,
      expectedAppId: appId,
    });

    expect(decrypted.plaintext).toBe(plaintext);
    expect(decrypted.appId).toBe(appId);
  });

  it("verifies msg_signature with encrypted payload", () => {
    const signature = computeMsgSignature({
      token: "callback-token",
      timestamp: "1710000000",
      nonce: "nonce-1",
      encrypt: "encrypted-body",
    });

    expect(
      verifyMsgSignature({
        token: "callback-token",
        timestamp: "1710000000",
        nonce: "nonce-1",
        encrypt: "encrypted-body",
        msgSignature: signature,
      })
    ).toBe(true);
  });

  it("parses xml bodies", () => {
    const xml = buildWechatMpXml({
      ToUserName: appId,
      FromUserName: "openid-1",
      MsgType: "text",
      Content: "hello",
      MsgId: "msg-1",
    });
    const parsed = parseWechatMpXml(xml);
    expect(parsed.ToUserName).toBe(appId);
    expect(parsed.FromUserName).toBe("openid-1");
    expect(parsed.Content).toBe("hello");
  });
});
