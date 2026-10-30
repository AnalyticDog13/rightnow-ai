import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Callout } from "../../../components/callout";
import { OnboardingWizard } from "../../../components/onboarding-wizard";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Set up owner account" };
export const dynamic = "force-dynamic";

export default async function SignUp() {
  if (await getSessionInfo(await headers())) redirect("/dashboard");
  if ((await prisma.user.count()) === 0) return <OnboardingWizard />;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 md:p-8">
      <h1 className="text-xl/7 font-semibold">Set up the owner account</h1>
      <Callout tone="neutral" role="status">
        Sign-up is closed. This workspace already has an owner; ask them for an invite, or{" "}
        <Link className="text-signal underline" href="/sign-in">
          sign in
        </Link>
        .
      </Callout>
    </div>
  );
}
