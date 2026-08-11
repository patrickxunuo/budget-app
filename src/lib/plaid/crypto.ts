import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "budget-app/plaid-token/v1", 32);
}

export function encryptAccessToken(token: string, secret: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), nonce, tag, ciphertext]);
}

export function decryptAccessToken(
  payload: Uint8Array,
  secret: string,
): string {
  const bytes = Buffer.from(payload);
  if (bytes.length <= 1 + NONCE_BYTES + TAG_BYTES || bytes[0] !== VERSION) {
    throw new Error("Invalid encrypted Plaid token payload");
  }
  const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
  const tag = bytes.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export function byteaHex(payload: Uint8Array): string {
  return `\\x${Buffer.from(payload).toString("hex")}`;
}

export function parseBytea(payload: string | Uint8Array): Buffer {
  if (typeof payload !== "string") return Buffer.from(payload);
  if (payload.startsWith("\\x")) return Buffer.from(payload.slice(2), "hex");
  return Buffer.from(payload, "base64");
}
