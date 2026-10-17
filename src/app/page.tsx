import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  // The root is a redirect-only manifest route: never render a public admin setup link
  // once any staff identity exists, and never bypass the authenticated dashboard.
  const firstUser = await prisma.user.findFirst({ select: { id: true } });
  redirect(firstUser ? "/login" : "/setup");
}
