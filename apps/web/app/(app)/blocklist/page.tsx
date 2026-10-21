import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { BlocklistManager } from "./blocklist-manager";

export const metadata: Metadata = { title: "Blocklist" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Blocklist</h1>
        <Link href="/leads" className="text-sm underline">
          Back to leads
        </Link>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Domains match exactly (blocking evil.test does not block mail.evil.test). Addresses and
        domains here are never emailed, in any campaign. Unsubscribes, bounces and complaints are
        added automatically.
      </p>
      <BlocklistManager
        canEdit={info.role !== "VIEWER"}
        isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
      />
    </div>
  );
}
