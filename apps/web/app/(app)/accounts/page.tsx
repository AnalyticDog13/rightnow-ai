import { getEnv, listAccounts } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { EmptyState } from "../../../components/empty-state";
import { PageHeader } from "../../../components/page-header";
import { getSessionInfo } from "../../../lib/workspace";
import { AccountsTable } from "./accounts-table";
import { ConnectMenu, NotConfigured } from "./connect-menu";
import { ConnectSmtp } from "./connect-smtp";

export const metadata: Metadata = { title: "Email Accounts" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  // shortcut: first 500 accounts, filtered in the browser; add server paging past that (API takes `cursor`).
  const { accounts } = await listAccounts(prisma, info.workspaceId, { take: 500 });
  const env = getEnv();
  const configured = {
    google: !!(env.MAIL_PROVIDER_FAKE || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)),
    microsoft: !!(env.MAIL_PROVIDER_FAKE || (env.MS_CLIENT_ID && env.MS_CLIENT_SECRET)),
  };
  const isAdmin = info.role === "OWNER" || info.role === "ADMIN";
  const empty = accounts.length === 0;
  // B5.3 deviation: the connect controls stay on the page (not behind a "Connect account" dialog) because the e2e
  // suite clicks "Connect Google" / "Connect with SMTP/IMAP" directly.
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email Accounts"
        description="Mailboxes that send your campaigns. Sending pauses automatically when an account needs attention."
        actions={
          isAdmin && !empty ? (
            <>
              <ConnectMenu configured={configured} />
              <ConnectSmtp />
            </>
          ) : undefined
        }
      />
      {isAdmin && (
        <NotConfigured
          providers={(["google", "microsoft"] as const).filter((p) => !configured[p])}
        />
      )}
      {empty ? (
        <EmptyState
          variant="page"
          title="Connect your first mailbox"
          body={
            <>
              rightnow sends from your own Google, Microsoft or IMAP/SMTP mailboxes. Warm a new
              mailbox for at least two weeks before full volume.
              {!isAdmin && (
                <span className="mt-2 block">Ask a workspace admin to connect a mailbox.</span>
              )}
            </>
          }
          actions={
            isAdmin ? (
              <>
                <ConnectMenu configured={configured} cards />
                <ConnectSmtp card />
              </>
            ) : undefined
          }
        />
      ) : (
        <AccountsTable
          accounts={accounts}
          canEdit={info.role !== "VIEWER"}
          isAdmin={isAdmin}
          configured={configured}
          staleAfterSec={env.SYNC_MAX_STALENESS_SEC}
        />
      )}
    </div>
  );
}
