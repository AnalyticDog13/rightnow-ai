import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../components/auth-form";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignIn() {
  if (await getSessionInfo(await headers())) redirect("/dashboard");
  const needsSetup = (await prisma.user.count()) === 0;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 md:p-8">
      <h1 className="text-xl/7 font-semibold">Sign in</h1>
      <AuthForm />
      {needsSetup && (
        <p className="text-[13px]/[18px] text-fg-muted">
          First time here?{" "}
          <Link className="text-signal underline underline-offset-2" href="/sign-up">
            Set up the owner account
          </Link>
          .
        </p>
      )}
    </div>
  );
}
