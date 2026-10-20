import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "../../../components/auth-form";
import { Card } from "../../../components/ui/card";
import { getSessionInfo } from "../../../lib/workspace";

export const metadata: Metadata = { title: "Set up owner account" };
export const dynamic = "force-dynamic";

export default async function SignUp() {
  if (await getSessionInfo(await headers())) redirect("/dashboard");
  const closed = (await prisma.user.count()) > 0;
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Set up the owner account</h1>
      {closed ? (
        <p role="status" className="text-sm text-muted-foreground">
          Sign-up is closed. This workspace already has an owner; ask them for an invite, or{" "}
          <Link className="text-primary underline" href="/sign-in">
            sign in
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Enter the SETUP_TOKEN from your server configuration.
          </p>
          <AuthForm mode="sign-up" />
        </>
      )}
    </Card>
  );
}
