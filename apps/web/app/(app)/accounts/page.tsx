import { getEnv } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "../../../components/ui/card";
import { getSessionInfo } from "../../../lib/workspace";
import { ConnectMenu } from "./connect-menu";

export const metadata: Metadata = { title: "Email Accounts" };
export const dynamic = "force-dynamic";

const PROVIDER = { GMAIL: "Google", MICROSOFT: "Microsoft", SMTP: "SMTP" } as const;

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const accounts = await prisma.emailAccount.findMany({
    where: { workspaceId: info.workspaceId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, provider: true, status: true, lifecycle: true },
  });
  const env = getEnv();
  const googleConfigured = !!(
    env.MAIL_PROVIDER_FAKE ||
    (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  );
  const canConnect = info.role === "OWNER" || info.role === "ADMIN";
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Email Accounts</h1>
      {canConnect && <ConnectMenu googleConfigured={googleConfigured} />}
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {["Email", "Provider", "Status"].map((h) => (
                <th key={h} className="p-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-border">
                <td className="p-3">{a.email}</td>
                <td className="p-3">{PROVIDER[a.provider]}</td>
                <td className="p-3">
                  {a.status === "CONNECTED"
                    ? a.lifecycle.toLowerCase().replace("_", " ")
                    : a.status.toLowerCase()}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-muted-foreground">
                  No email accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
