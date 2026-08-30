import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM encryption for secrets at rest (OAuth tokens, API keys stored per
 * user). Key is derived from ENCRYPTION_KEY. Ciphertext format:
 *   base64(salt[16] | iv[12] | authTag[16] | ciphertext)
 */

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(env.encryptionKey, salt, 32);
}

export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, enc]).toString("base64");
}

export function decryptSecret(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const enc = buf.subarray(44);
  const key = deriveKey(salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function encryptJson(obj: unknown): string {
  return encryptSecret(JSON.stringify(obj));
}
export function decryptJson<T = unknown>(blob: string): T {
  return JSON.parse(decryptSecret(blob)) as T;
}
