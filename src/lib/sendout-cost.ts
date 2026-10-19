/** Validate referral/send-out cost without IEEE-754 rounding or implicit currency conversion.
 * Data model: DECIMAL(18,4), at most 14 integral and 4 fractional digits.
 * Prefer JSON string amounts from clients; accepted JSON numeric values retain
 * their serialized decimal lexeme but cannot restore upstream lost precision.
 */
export function parseSendOutCost(amount: unknown, currency: unknown):
  | { kind: "ok"; amount: string | null; currency: string | null }
  | { kind: "invalid" } {
  const empty = amount === null || amount === undefined || amount === "";
  const raw = empty ? "" : typeof amount === "string" || typeof amount === "number"
    ? String(amount).trim() : "";
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  if (empty && !code) return { kind: "ok", amount: null, currency: null };
  if (empty || !/^[A-Z]{3}$/.test(code) ||
      !/^(?:\d{1,14})(?:\.\d{1,4})?$/.test(raw)) return { kind: "invalid" };
  return { kind: "ok", amount: raw, currency: code };
}
