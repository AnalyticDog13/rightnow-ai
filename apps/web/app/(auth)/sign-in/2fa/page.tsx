import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TwoFactorForm } from "../../../../components/two-factor-form";
import { getSessionInfo } from "../../../../lib/workspace";

export const metadata: Metadata = { title: "Two-factor sign-in" };
export const dynamic = "force-dynamic";

export default async function TwoFactor() {
  if (await getSessionInfo(await headers())) redirect("/dashboard");
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 md:p-8">
      <h1 className="text-xl/7 font-semibold">Two-factor authentication</h1>
      <p className="text-[13px]/[18px] text-fg-muted">
        Enter the code from your authenticator app. The sign-in expires after 10 minutes;{" "}
        <Link className="text-signal underline underline-offset-2" href="/sign-in">
          start again
        </Link>{" "}
        if it did.
      </p>
      <TwoFactorForm />
    </div>
  );
}
