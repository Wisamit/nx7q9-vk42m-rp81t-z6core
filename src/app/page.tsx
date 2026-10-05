import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  const hasUsers = (await prisma.user.count()) > 0;
  redirect(hasUsers ? "/login" : "/setup");
}
