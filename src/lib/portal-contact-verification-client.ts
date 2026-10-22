/**
 * Portal contact OTP request/verification transport boundary.
 *
 * A transport failure, HTTP 5xx or malformed success receipt is ambiguous:
 * the server might already have committed the challenge or verification.
 * Never translate ambiguous responses into a successful browser state, and
 * never automatically retry a mutation with an unknown outcome.
 */
type Sender = (input: string, init: RequestInit) => Promise<Response>;
type Rejected = {kind:"rejected"; error:string};
type Uncertain = {kind:"uncertain"};

export type ContactChallengeOutcome =
  | {kind:"queued"; challengeId:string; destination:string}
  | Rejected | Uncertain;
export type ContactVerifyOutcome =
  | {kind:"verified"} | Rejected | Uncertain;

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(body: unknown): Record<string,unknown> | null {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string,unknown> : null;
}

async function submit(
  route:string, body: Record<string,string>, send:Sender,
): Promise<{response:Response; payload:Record<string,unknown>|null}|null> {
  try {
    const response=await send(route,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body),
    });
    const payload=record(await response.json().catch(()=>null));
    return {response,payload};
  } catch {
    // Never leak transport/response exceptions into the clinical-facing UI.
    return null;
  }
}

function rejection(result:NonNullable<Awaited<ReturnType<typeof submit>>>): Rejected | null {
  if(result.response.status>=400&&result.response.status<500){
    return {kind:"rejected",error:typeof result.payload?.error==="string"
      ? result.payload.error:"unknown"};
  }
  return null;
}

export async function requestContactChallenge(
  channel:"EMAIL"|"SMS",send:Sender=fetch,
):Promise<ContactChallengeOutcome> {
  const result=await submit("/api/portal/auth/contact-verification/request",{channel},send);
  if(!result)return {kind:"uncertain"};
  const rejected=rejection(result);
  if(rejected)return rejected;
  const payload=result.payload;
  if(result.response.status!==201 || !result.response.ok ||
     payload?.status!=="queued" ||
     typeof payload.challengeId!=="string" ||
     !uuidPattern.test(payload.challengeId) ||
     typeof payload.destination!=="string" ||
     !payload.destination.trim()) return {kind:"uncertain"};
  return {kind:"queued",challengeId:payload.challengeId,destination:payload.destination};
}

export async function verifyContactChallenge(
  challengeId:string,code:string,send:Sender=fetch,
):Promise<ContactVerifyOutcome> {
  const result=await submit("/api/portal/auth/contact-verification/verify",{challengeId,code},send);
  if(!result)return {kind:"uncertain"};
  const rejected=rejection(result);
  if(rejected)return rejected;
  if(result.response.status!==200 || !result.response.ok ||
     result.payload?.status!=="verified") return {kind:"uncertain"};
  return {kind:"verified"};
}
