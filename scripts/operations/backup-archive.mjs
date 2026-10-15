/**
 * Encrypted streaming full-database backup format FLBK1291.
 * Contents are compressed SQL from a privileged dump process. Nothing here
 * stores passwords, patient records, or unencrypted SQL in a backup directory.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

const MAGIC = Buffer.from("FLBK1291", "ascii");
const HEADER_LENGTH = MAGIC.length + 12;
const TAG_LENGTH = 16;

export function backupEncryptionKey(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw Error("BACKUP_KEY_32_BYTE_HEX_REQUIRED");
  }
  const key = Buffer.from(value, "hex");
  if (key.every(byte => byte === 0)) throw Error("BACKUP_KEY_WEAK");
  return key;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function encryptBackupStream(source, target, key) {
  const iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const prefixed = new PassThrough();
  prefixed.write(header);
  let plainBytes = 0;
  const counter = new PassThrough();
  counter.on("data", chunk => { plainBytes += chunk.length; });
  try {
    await pipeline(source, counter, createGzip({ level: 6 }), cipher, prefixed,
      createWriteStream(target, { flags: "wx", mode: 0o600 }));
    if (plainBytes < 1) throw Error("BACKUP_EMPTY_SQL_STREAM");
    const fd = await open(target, "a", 0o600);
    try { await fd.write(cipher.getAuthTag()); await fd.sync(); } finally { await fd.close(); }
    return { sizeBytes: (await stat(target)).size, sha256: await sha256File(target), plainBytes };
  } catch (error) {
    await rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

export async function verifyEncryptedBackup(file, key, metadata = null) {
  const info = await stat(file);
  if (!info.isFile() || info.size <= HEADER_LENGTH + TAG_LENGTH) throw Error("BACKUP_ARCHIVE_INVALID");
  if (metadata && (info.size !== metadata.sizeBytes ||
      !/^[0-9a-f]{64}$/.test(metadata.sha256 || ""))) throw Error("BACKUP_MANIFEST_MISMATCH");
  if (metadata) {
    const found = Buffer.from(await sha256File(file), "hex");
    const expected = Buffer.from(metadata.sha256, "hex");
    if (!timingSafeEqual(found, expected)) throw Error("BACKUP_ARCHIVE_HASH_MISMATCH");
  }
  const fd = await open(file, "r");
  const header = Buffer.alloc(HEADER_LENGTH);
  const tag = Buffer.alloc(TAG_LENGTH);
  try {
    if ((await fd.read(header, 0, HEADER_LENGTH, 0)).bytesRead !== HEADER_LENGTH ||
        (await fd.read(tag, 0, TAG_LENGTH, info.size - TAG_LENGTH)).bytesRead !== TAG_LENGTH ||
        !header.subarray(0, MAGIC.length).equals(MAGIC)) throw Error("BACKUP_ARCHIVE_INVALID");
  } finally { await fd.close(); }
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  let plainBytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, done) { plainBytes += chunk.length; done(); },
  });
  // No unauthenticated plaintext is emitted to a file or the console.
  await pipeline(createReadStream(file,{start:HEADER_LENGTH,end:info.size-TAG_LENGTH-1}),
    decipher, createGunzip(), sink);
  if (plainBytes < 1) throw Error("BACKUP_EMPTY_SQL_STREAM");
  return { sizeBytes: info.size, plainBytes };
}

export async function durablePublish(from, to) {
  await rename(from, to);
  const folder = await open(new URL(".", "file://" + to).pathname, "r");
  try { await folder.sync(); } catch (error) { if (process.platform !== "win32") throw error; }
  finally { await folder.close(); }
}
