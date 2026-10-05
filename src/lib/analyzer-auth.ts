import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export async function authenticateAnalyzerBridge(request: Request, analyzerId: string) {
  const token = bearerToken(request);
  if (!token || token.length < 32 || token.length > 512) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const credential = await prisma.analyzerCredential.findFirst({
    where: {
      analyzerId,
      tokenHash,
      status: "ACTIVE",
      analyzer: { status: "ACTIVE" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { analyzer: true },
  });

  if (!credential) return null;

  await prisma.analyzerCredential.update({
    where: { id: credential.id },
    data: { lastUsedAt: new Date() },
  });

  return credential;
}
