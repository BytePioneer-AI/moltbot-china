/**
 * 企业微信客户渠道加解密 - 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  computeWecomKhMsgSignature,
  verifyWecomKhSignature,
  decryptWecomKhEncrypted,
  encryptWecomKhPlaintext,
} from "../crypto.js";

describe("crypto", () => {
  const TEST_ENCODING_AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const TEST_RECEIVE_ID = "ww12345678910";

  describe("computeWecomKhMsgSignature", () => {
    it("应对输入进行排序并计算 SHA1", () => {
      const result = computeWecomKhMsgSignature({
        token: "test_token",
        timestamp: "1234567890",
        nonce: "test_nonce",
        encrypt: "test_encrypt",
      });
      expect(result).toMatch(/^[a-f0-9]{40}$/);
    });

    it("相同参数应产生相同签名", () => {
      const params = {
        token: "mytoken",
        timestamp: "9999999999",
        nonce: "mynonce",
        encrypt: "myencrypt",
      };
      const a = computeWecomKhMsgSignature(params);
      const b = computeWecomKhMsgSignature(params);
      expect(a).toBe(b);
    });
  });

  describe("verifyWecomKhSignature", () => {
    it("正确签名应通过验证", () => {
      const params = {
        token: "mytoken",
        timestamp: "1234567890",
        nonce: "nonce123",
        encrypt: "some_encrypt_value",
      };
      const signature = computeWecomKhMsgSignature(params);
      expect(
        verifyWecomKhSignature({ ...params, signature })
      ).toBe(true);
    });

    it("错误签名应验证失败", () => {
      expect(
        verifyWecomKhSignature({
          token: "mytoken",
          timestamp: "1234567890",
          nonce: "nonce123",
          encrypt: "some_encrypt_value",
          signature: "wrong_signature",
        })
      ).toBe(false);
    });
  });

  describe("encrypt/decrypt 对称操作", () => {
    it("加密后解密应还原明文", () => {
      const plaintext = '{"hello":"world","中文":"测试"}';
      const encrypted = encryptWecomKhPlaintext({
        encodingAESKey: TEST_ENCODING_AES_KEY,
        receiveId: TEST_RECEIVE_ID,
        plaintext,
      });
      expect(encrypted).toBeTruthy();
      expect(typeof encrypted).toBe("string");

      const decrypted = decryptWecomKhEncrypted({
        encodingAESKey: TEST_ENCODING_AES_KEY,
        receiveId: TEST_RECEIVE_ID,
        encrypt: encrypted,
      });
      expect(decrypted).toBe(plaintext);
    });

    it("不使用 receiveId 时也能正常工作", () => {
      const plaintext = "test message without receiveId";
      const encrypted = encryptWecomKhPlaintext({
        encodingAESKey: TEST_ENCODING_AES_KEY,
        plaintext,
      });
      const decrypted = decryptWecomKhEncrypted({
        encodingAESKey: TEST_ENCODING_AES_KEY,
        encrypt: encrypted,
      });
      expect(decrypted).toBe(plaintext);
    });

    it("错误的 receiveId 应抛异常", () => {
      const plaintext = "test";
      const encrypted = encryptWecomKhPlaintext({
        encodingAESKey: TEST_ENCODING_AES_KEY,
        receiveId: "corp_a",
        plaintext,
      });
      expect(() =>
        decryptWecomKhEncrypted({
          encodingAESKey: TEST_ENCODING_AES_KEY,
          receiveId: "corp_b",
          encrypt: encrypted,
        })
      ).toThrow(/receiveId mismatch/);
    });
  });

  describe("错误处理", () => {
    it("空 encodingAESKey 应抛异常", () => {
      expect(() =>
        encryptWecomKhPlaintext({
          encodingAESKey: "",
          plaintext: "test",
        })
      ).toThrow(/encodingAESKey missing/);
    });
  });
});
