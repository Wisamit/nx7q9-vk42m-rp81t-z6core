import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encryptionKey() {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("APP_ENCRYPTION_KEY must be configured with at least 32 characters before staff MFA can be used.");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string) {
  const [ivPart, tagPart, cipherPart] = value.split(".");
  if (!ivPart || !tagPart || !cipherPart) throw new Error("Invalid encrypted MFA secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function newTotpSecret(bytes = 20) {
  const input = randomBytes(bytes);
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    result += BASE32[Number.parseInt(chunk, 2)];
  }
  return result;
}

function decodeBase32(value: string) {
  const normalized = value.replace(/=+$/g, "").toUpperCase().replace(/\s+/g, "");
  let bits = "";
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid Base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpAt(secret: string, timestamp: number) {
  const counter = Math.floor(timestamp / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return code.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = Date.now()) {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  return [-1, 0, 1].some(step => totpAt(secret, now + step * 30_000) === normalized);
}

export function totpUri(secret: string, username: string, organizationName: string) {
  const issuer = "Family Lab LIS";
  const label = encodeURIComponent(organizationName + ":" + username);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function newMfaChallengeToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => randomBytes(6).toString("hex").toUpperCase());
}

export async function hashRecoveryCodes(codes: string[]) {
  return Promise.all(codes.map(code => hash(code, 10)));
}

export async function consumeRecoveryCode(code: string, hashes: string[]) {
  const normalized = code.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  for (let index = 0; index < hashes.length; index++) {
    if (await compare(normalized, hashes[index])) {
      return { valid: true, remaining: hashes.filter((_, i) => i !== index) };
    }
  }
  return { valid: false, remaining: hashes };
}
