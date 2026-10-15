import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;
export type ProviderReceipt = {
  organizationId: string;
  deliveryId: string;
  channel: typeof CHANNELS[number];
  providerMessageId: string;
  receiptId: string;
  status: "DELIVERED" | "FAILED";
};
export class ProviderReceiptError extends Error {
  constructor(public readonly code: string, public readonly httpStatus = 400) { super(code); }
}
function textId(input: unknown, max: number) {
  return typeof input === "string" && input.length >= 1 && input.length <= max &&
    /^[A-Za-z0-9._:/-]+$/.test(input);
}
export function parseProviderReceipt(raw: string): ProviderReceipt {
  if (Buffer.byteLength(raw, "utf8") > 8192) throw new ProviderReceiptError("receipt_too_large", 413);
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new ProviderReceiptError("invalid_receipt"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProviderReceiptError("invalid_receipt");
  const item = value as Record<string, unknown>;
  if (typeof item.organizationId !== "string" || !UUID.test(item.organizationId) ||
      typeof item.deliveryId !== "string" || !UUID.test(item.deliveryId) ||
      !CHANNELS.includes(item.channel as ProviderReceipt["channel"]) ||
      !textId(item.providerMessageId, 255) || !textId(item.receiptId, 255) ||
      (item.status !== "DELIVERED" && item.status !== "FAILED") ||
      Object.keys(item).some(key => !["organizationId","deliveryId","channel","providerMessageId","receiptId","status"].includes(key))) {
    throw new ProviderReceiptError("invalid_receipt");
  }
  return item as ProviderReceipt;
}
export function providerReceiptSecret(master: string | undefined, input: ProviderReceipt): Buffer {
  if (!master || master.length < 32 || master.length > 512 || /\s/.test(master)) {
    throw new ProviderReceiptError("receipt_provider_not_configured", 503);
  }
  // A unique tenant/channel key is provisioned to each gateway, never a global master.
  return createHmac("sha256", master).update("familylab-provider:" + input.organizationId + ":" + input.channel).digest();
}
export function verifyProviderReceiptSignature(
  raw: string, input: ProviderReceipt, timestamp: string | null, signature: string | null,
  master: string | undefined, now = Date.now(),
): void {
  const secret = providerReceiptSecret(master, input);
  if (!timestamp || !/^[0-9]{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp) * 1000) > 300_000 ||
      !signature || !/^sha256=[0-9a-f]{64}$/i.test(signature)) {
    throw new ProviderReceiptError("receipt_not_authorized", 401);
  }
  const expected = createHmac("sha256", secret).update(timestamp + "." + raw).digest();
  const received = Buffer.from(signature.slice(7), "hex");
  if (!timingSafeEqual(expected, received)) throw new ProviderReceiptError("receipt_not_authorized", 401);
}
export function providerReceiptFingerprint(input: ProviderReceipt) {
  return createHash("sha256").update(JSON.stringify([
    input.organizationId, input.deliveryId, input.channel,
    input.providerMessageId, input.receiptId, input.status,
  ])).digest("hex");
}
