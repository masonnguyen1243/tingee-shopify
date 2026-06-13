import { gcm } from "@noble/ciphers/aes.js";
import { managedNonce, utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils.js";

function toKeyBytes(key: string): Uint8Array {
  if (!key) throw new Error("ENCRYPTION_KEY is required");
  return Buffer.from(key, "base64");
}

export function encrypt(plaintext: string, key: string): string {
  const cipher = managedNonce(gcm)(toKeyBytes(key));
  return Buffer.from(cipher.encrypt(utf8ToBytes(plaintext))).toString("base64");
}

export function decrypt(ciphertext: string, key: string): string {
  const cipher = managedNonce(gcm)(toKeyBytes(key));
  return bytesToUtf8(cipher.decrypt(Buffer.from(ciphertext, "base64")));
}
