import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "../../../../components/ui/card";
import { TwoFactorForm } from "../../../../components/two-factor-form";
import { getSessionInfo } from "../../../../lib/workspace";

export const metadata: Metadata = { title: "Two-factor sign-in" };
export const dynamic = "force-dynamic";

export default async function TwoFactor() {
  if (await getSessionInfo(await headers())) redirect("/dashboard");
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>
      <p className="text-sm text-muted-foreground">
        Enter the code from your authenticator app. The sign-in expires after 10 minutes;{" "}
        <Link className="text-primary underline" href="/sign-in">
          start again
        </Link>{" "}
        if it did.
      </p>
      <TwoFactorForm />
    </Card>
  );
}
