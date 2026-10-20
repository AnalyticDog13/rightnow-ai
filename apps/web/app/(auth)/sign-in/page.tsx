import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "../../../components/auth-form";
import { Card } from "../../../components/ui/card";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignIn() {
  const needsSetup = (await prisma.user.count()) === 0;
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <AuthForm mode="sign-in" />
      {needsSetup && (
        <p className="text-sm text-muted-foreground">
          First time here?{" "}
          <Link className="text-primary underline" href="/sign-up">
            Set up the owner account
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
