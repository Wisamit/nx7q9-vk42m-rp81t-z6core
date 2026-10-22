/**
 * Authentication UI transport boundary.
 *
 * A lost response can follow a committed session, MFA challenge or password
 * change. Never infer success from HTTP 2xx without the expected receipt,
 * expose raw transport errors, or automatically replay an ambiguous mutation.
 * Server routes still own all authorization, rate limiting and credential
 * verification.
 */
type Sender = (input: string, init: RequestInit) => Promise<Response>;
type Rejected = { kind: "rejected"; error: string };
type Uncertain = { kind: "uncertain" };
type Failure = Rejected | Uncertain;

export type StaffAuthOutcome =
  | { kind: "authenticated" }
  | { kind: "mfa_required" }
  | Failure;

export type PortalLoginOutcome =
  | { kind: "authenticated"; mustChangePassword: boolean }
  | Failure;

export type PortalPasswordChangeOutcome =
  | { kind: "changed" }
  | Failure;

type HttpReceipt = { status: number; ok: boolean; body: Record<string,unknown> | null };

async function post(
  url: string, payload: Record<string,unknown>, send: Sender,
): Promise<HttpReceipt | null> {
  try {
    const response = await send(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json: unknown = await response.json().catch(() => null);
    const body = json && typeof json === "object" && !Array.isArray(json)
      ? json as Record<string,unknown> : null;
    return { status: response.status, ok: response.ok, body };
  } catch {
    return null;
  }
}

function rejectKnown(response: HttpReceipt): Rejected | null {
  if (response.status < 400 || response.status >= 500) return null;
  return {
    kind: "rejected",
    error: typeof response.body?.error === "string" ? response.body.error : "unknown",
  };
}

export async function submitStaffSignIn(
  payload: { username?: unknown; password?: unknown; code?: unknown },
  mfaPending: boolean,
  send: Sender = fetch,
): Promise<StaffAuthOutcome> {
  const receipt = await post(
    mfaPending ? "/api/auth/mfa/verify" : "/api/auth/login",
    mfaPending ? { code: payload.code } : {
      username: payload.username, password: payload.password,
    }, send,
  );
  if (!receipt) return { kind: "uncertain" };
  const rejected = rejectKnown(receipt);
  if (rejected) return rejected;
  if (receipt.status === 200 && receipt.ok && receipt.body?.status === "ok")
    return { kind: "authenticated" };
  if (!mfaPending && receipt.status === 202 && receipt.ok &&
      receipt.body?.status === "mfa_required" && receipt.body.mfaRequired === true)
    return { kind: "mfa_required" };
  return { kind: "uncertain" };
}

export async function submitPortalSignIn(
  payload: { organizationCode: unknown; login: unknown; password: unknown },
  send: Sender = fetch,
): Promise<PortalLoginOutcome> {
  const receipt = await post("/api/portal/auth/login", payload, send);
  if (!receipt) return { kind: "uncertain" };
  const rejected = rejectKnown(receipt);
  if (rejected) return rejected;
  if (receipt.status === 200 && receipt.ok && receipt.body?.status === "ok" &&
      typeof receipt.body.mustChangePassword === "boolean")
    return { kind: "authenticated", mustChangePassword: receipt.body.mustChangePassword };
  return { kind: "uncertain" };
}

export async function submitPortalPasswordChange(
  password: string,
  send: Sender = fetch,
): Promise<PortalPasswordChangeOutcome> {
  const receipt = await post("/api/portal/auth/change-password", { password }, send);
  if (!receipt) return { kind: "uncertain" };
  const rejected = rejectKnown(receipt);
  if (rejected) return rejected;
  if (receipt.status === 200 && receipt.ok && receipt.body?.status === "ok")
    return { kind: "changed" };
  return { kind: "uncertain" };
}
