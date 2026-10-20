import { getEnv, listAccounts } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionInfo } from "../../../lib/workspace";
import { AccountsTable } from "./accounts-table";
import { ConnectMenu } from "./connect-menu";

export const metadata: Metadata = { title: "Email Accounts" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  // shortcut: first 500 accounts, filtered in the browser; add server paging past that (API takes `cursor`).
  const { accounts } = await listAccounts(prisma, info.workspaceId, { take: 500 });
  const env = getEnv();
  const googleConfigured = !!(
    env.MAIL_PROVIDER_FAKE ||
    (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  );
  const isAdmin = info.role === "OWNER" || info.role === "ADMIN";
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Email Accounts</h1>
      {isAdmin && <ConnectMenu googleConfigured={googleConfigured} />}
      <AccountsTable
        accounts={accounts}
        canEdit={info.role !== "VIEWER"}
        isAdmin={isAdmin}
        googleConfigured={googleConfigured}
      />
    </div>
  );
}
