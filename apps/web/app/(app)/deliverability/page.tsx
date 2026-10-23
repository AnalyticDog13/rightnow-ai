import {
  deliverabilityOverview,
  getWorkspaceSettings,
  sendableProviders,
  systemClock,
} from "@rightnow/core";
import { prisma } from "@rightnow/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getWebEnv } from "../../../lib/env";
import { getSessionInfo } from "../../../lib/workspace";
import { DeliverabilitySettings } from "./deliverability-settings";
import { DeliverabilityTable } from "./deliverability-table";

export const metadata: Metadata = { title: "Deliverability" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const info = await getSessionInfo(await headers());
  if (!info) redirect("/sign-in");
  const admin = info.role === "OWNER" || info.role === "ADMIN";
  const [rows, settings] = await Promise.all([
    deliverabilityOverview(
      prisma,
      info.workspaceId,
      systemClock.now(),
      await sendableProviders(prisma, getWebEnv()),
    ),
    admin ? getWorkspaceSettings(prisma, info.workspaceId) : null,
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Deliverability</h1>
        <Link href="/deliverability/placement" className="text-sm underline">
          Inbox placement tests
        </Link>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Warm-up and re-warm-up cannot guarantee inbox placement. Health is an internal indicator,
        not a reputation guarantee.
      </p>
      <ul className="max-w-3xl list-disc pl-5 text-sm text-muted-foreground">
        <li>Recommended: about 30 campaign emails and 10 warm-up emails per account and day.</li>
        <li>
          Warm a new account for at least two weeks before full volume; four weeks is safer for a
          new domain.
        </li>
        <li>
          Warm-up knobs: reply rate is a cooperative-mailbox action. Read emulation, open rate, spam
          protection and mark important are not provided.
        </li>
      </ul>
      <DeliverabilityTable rows={rows} canEdit={info.role !== "VIEWER"} />
      {settings && <DeliverabilitySettings {...settings} />}
    </div>
  );
}
