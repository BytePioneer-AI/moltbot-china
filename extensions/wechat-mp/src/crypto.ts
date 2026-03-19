/**
 * WeChat MP crypto utilities
 *
 * Provides:
 * - computeSignature: Compute signature for GET verification
 * - verifySignature: Verify signature for GET validation
 * - computeMsgSignature: Compute msg_signature for POST validation
 * - verifyMsgSignature: Verify msg_signature for POST validation (safe mode)
 * - decryptWechatMpMessage: Decrypt AES encrypted message
 * - encryptWechatMpMessage: Encrypt plaintext for encrypted reply (safe mode)
 * - parseWechatMpXml: Parse XML message body
 * - buildWechatMpXml: Build XML message for passive reply
 */

import crypto from "node:crypto";
import type { ResolvedWechatMpAccount } from "./types.js";

const BLOCK_SIZE = 32;
const AES_KEY_SIZE = 32;
const IV_SIZE = 16;

// ============================================================================
// Signature Utilities
// ============================================================================

/**
 * Compute signature for GET callback verification
 * Used for URL callback verification
 */
export function computeSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
}): string {
  const parts = [params.token, params.timestamp, params.nonce]
    .map((v) => String(v ?? "").trim())
    .sort();
  return crypto.createHash("sha1").update(parts.join("")).digest("hex");
}

/**
 * Verify GET callback signature (URL verification)
 */
export function verifySignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  signature: string;
}): boolean {
  const computed = computeSignature({
    token: params.token,
    timestamp: params.timestamp,
    nonce: params.nonce,
  });
  return computed === params.signature;
}

/**
 * Compute msg_signature for POST body validation (safe mode)
 */
export function computeMsgSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
}): string {
  const parts = [params.token, params.timestamp, params.nonce, params.encrypt]
    .map((v) => String(v ?? "").trim())
    .sort();
  return crypto.createHash("sha1").update(parts.join("")).digest("hex");
}

/**
 * Verify msg_signature for POST body validation (safe mode)
 */
export function verifyMsgSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypt: string;
  msgSignature: string;
}): boolean {
  const computed = computeMsgSignature({
    token: params.token,
    timestamp: params.timestamp,
    nonce: params.nonce,
    encrypt: params.encrypt,
  });
  return computed === params.msgSignature;
}

// ============================================================================
// AES Encryption/Decryption
// ============================================================================

/**
 * Decode encodingAESKey from base64 to 32-byte AES key
 */
function decodeEncodingAESKey(encodingAESKey: string): Buffer {
  const trimmed = encodingAESKey.trim();
  if (!trimmed) {
    throw new Error("encodingAESKey is required");
  }
  // Add base64 padding if needed
  const withPadding = trimmed.endsWith("=") ? trimmed : `${trimmed}=`;
  const decoded = Buffer.from(withPadding, "base64");
  if (decoded.length !== AES_KEY_SIZE) {
    throw new Error(
      `Invalid encodingAESKey: expected ${AES_KEY_SIZE} bytes, got ${decoded.length}`
    );
  }
  return decoded;
}

/**
 * PKCS7 unpad
 */
function pkcs7Unpad(buf: Buffer, blockSize: number): Buffer {
  if (buf.length === 0) {
    throw new Error("Invalid PKCS7 payload: empty buffer");
  }
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > blockSize) {
    throw new Error(`Invalid PKCS7 padding: ${pad}`);
  }
  for (let i = 1; i <= pad; i++) {
    if (buf[buf.length - i] !== pad) {
      throw new Error("Invalid PKCS7 padding: inconsistent bytes");
    }
  }
  return buf.subarray(0, buf.length - pad);
}

/**
 * PKCS7 pad
 */
function pkcs7Pad(buf: Buffer, blockSize: number): Buffer {
  const padLen = blockSize - (buf.length % blockSize);
  const pad = Buffer.alloc(padLen, padLen);
  return Buffer.concat([buf, pad]);
}

/**
 * Decrypt AES-256-CBC encrypted message (safe mode)
 * Returns the plaintext XML content
 */
export function decryptWechatMpMessage(params: {
  encodingAESKey: string;
  encrypt: string;
  expectedAppId?: string;
}): { plaintext: string; appId: string } {
  const aesKey = decodeEncodingAESKey(params.encodingAESKey);
  const iv = aesKey.subarray(0, IV_SIZE);

  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);

  const decryptedPadded = Buffer.concat([
    decipher.update(Buffer.from(params.encrypt, "base64")),
    decipher.final(),
  ]);

  const decrypted = pkcs7Unpad(decryptedPadded, BLOCK_SIZE);

  // Format: random(16) + msgLen(4) + msg + appId
  if (decrypted.length < 20) {
    throw new Error(`Invalid decrypted payload length: ${decrypted.length}`);
  }

  const msgLen = decrypted.readUInt32BE(16);
  const msgStart = 20;
  const msgEnd = msgStart + msgLen;

  if (msgEnd > decrypted.length) {
    throw new Error("Invalid decrypted message length");
  }

  const plaintext = decrypted.subarray(msgStart, msgEnd).toString("utf8");
  const appId = decrypted.subarray(msgEnd).toString("utf8").trim();

  // Verify appId if expected
  if (params.expectedAppId && appId !== params.expectedAppId) {
    throw new Error(
      `AppId mismatch: expected "${params.expectedAppId}", got "${appId}"`
    );
  }

  return { plaintext, appId };
}

/**
 * Encrypt plaintext for encrypted reply (safe mode)
 */
export function encryptWechatMpMessage(params: {
  encodingAESKey: string;
  appId: string;
  plaintext: string;
}): { encrypt: string } {
  const aesKey = decodeEncodingAESKey(params.encodingAESKey);
  const iv = aesKey.subarray(0, IV_SIZE);

  // Build plaintext: random(16) + msgLen(4) + msg + appId
  const randomBytes = crypto.randomBytes(16);
  const msgBuffer = Buffer.from(params.plaintext, "utf8");
  const msgLenBuffer = Buffer.alloc(4);
  msgLenBuffer.writeUInt32BE(msgBuffer.length, 0);
  const appIdBuffer = Buffer.from(params.appId, "utf8");

  const plainBuffer = Buffer.concat([randomBytes, msgLenBuffer, msgBuffer, appIdBuffer]);

  // PKCS7 pad
  const padded = pkcs7Pad(plainBuffer, BLOCK_SIZE);

  // Encrypt
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  cipher.setAutoPadding(false);
  const encryptedBuffer = Buffer.concat([cipher.update(padded), cipher.final()]);

  return { encrypt: encryptedBuffer.toString("base64") };
}

/**
 * Build encrypted reply XML
 */
export function buildEncryptedReplyXml(params: {
  encrypt: string;
  signature: string;
  timestamp: string;
  nonce: string;
}): string {
  return `<xml>
<Encrypt><![CDATA[${params.encrypt}]]></Encrypt>
<MsgSignature><![CDATA[${params.signature}]]></MsgSignature>
<TimeStamp>${params.timestamp}</TimeStamp>
<Nonce><![CDATA[${params.nonce}]]></Nonce>
</xml>`;
}

// ============================================================================
// XML Utilities
// ============================================================================

/**
 * Parse XML message body to structured object (lightweight, no external deps)
 */
export function parseWechatMpXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Match CDATA format: <Tag><![CDATA[value]]></Tag>
  const cdataRegex = /<([\w:-]+)><!\[CDATA\[([\s\S]*?)\]\]><\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = cdataRegex.exec(xml)) !== null) {
    const [, key, value] = match;
    if (key) {
      result[key] = value ?? "";
    }
  }

  // Match simple format: <Tag>value</Tag>
  const simpleRegex = /<([\w:-]+)>([^<]*)<\/\1>/g;
  while ((match = simpleRegex.exec(xml)) !== null) {
    const [, key, value] = match;
    if (key && result[key] === undefined) {
      result[key] = value ?? "";
    }
  }

  return result;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Escape CDATA ending
 */
function escapeCData(str: string): string {
  return str.replace(/\]\]>/g, "]]&gt;");
}

/**
 * Build XML message for WeChat MP passive reply
 */
export function buildWechatMpXml(data: Record<string, string | number>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const strValue = String(value);
    parts.push(`<${key}><![CDATA[${escapeCData(strValue)}]]></${key}>`);
  }
  return `<xml>${parts.join("")}</xml>`;
}

/**
 * Build raw XML message (without CDATA escaping)
 */
export function buildWechatMpXmlRaw(data: Record<string, string | number>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    parts.push(`<${key}>${value}</${key}>`);
  }
  return `<xml>${parts.join("")}</xml>`;
}

// ============================================================================
// Mode Detection
// ============================================================================

/**
 * Check if message mode requires encryption
 */
export function isSafeMode(account: ResolvedWechatMpAccount): boolean {
  return account.config.messageMode === "safe" || account.config.messageMode === "compat";
}

/**
 * Check if plain mode is enabled
 */
export function isPlainMode(account: ResolvedWechatMpAccount): boolean {
  return account.config.messageMode === "plain" || !account.config.messageMode;
}

/**
 * Check if compat mode is enabled (both encrypted and plain supported)
 */
export function isCompatMode(account: ResolvedWechatMpAccount): boolean {
  return account.config.messageMode === "compat";
}

/**
 * Build plain text reply XML for passive reply
 */
export function buildPlainReplyXml(params: {
  toUserName: string;
  fromUserName: string;
  createTime: number;
  msgType: "text";
  content: string;
}): string {
  return buildWechatMpXml({
    ToUserName: params.toUserName,
    FromUserName: params.fromUserName,
    CreateTime: String(params.createTime),
    MsgType: params.msgType,
    Content: params.content,
  });
}
