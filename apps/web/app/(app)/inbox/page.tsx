import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { InboxApp } from "./inbox-app";

export const metadata: Metadata = { title: "Unified inbox" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  return (
    <InboxApp
      canEdit={info.role !== "VIEWER"}
      isAdmin={info.role === "OWNER" || info.role === "ADMIN"}
    />
  );
}
