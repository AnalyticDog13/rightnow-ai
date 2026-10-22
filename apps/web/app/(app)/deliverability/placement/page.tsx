import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../../lib/workspace";
import { PlacementManager } from "./placement-manager";

export const metadata: Metadata = { title: "Inbox placement" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Inbox placement</h1>
        <Link href="/deliverability" className="text-sm underline">
          Back to deliverability
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Sends one message from the account you pick to each of your own mailboxes that you marked as
        a placement seed (in the account settings), then reports whether it reached the inbox or the
        spam folder. Results appear after about 10 minutes. The test counts against the
        account&apos;s daily quota, and its headers differ slightly from a real campaign email.
      </p>
      <PlacementManager isAdmin={info.role === "OWNER" || info.role === "ADMIN"} />
    </div>
  );
}
