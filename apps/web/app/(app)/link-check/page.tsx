import type { Metadata } from "next";
import { linkTarget } from "../../../lib/link-check";
import { LinkCheck } from "./link-check";

export const metadata: Metadata = { title: "Check this link" };
export const dynamic = "force-dynamic";

/**
 * Where a mismatched link in a message lands (message-frame rewrites it). Inside (app), so it needs a session, and it
 * never redirects: the person sees the real host and chooses.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const target = linkTarget(one(sp.to));
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Check this link</h1>
      {target ? (
        <LinkCheck
          url={target.url}
          host={target.host}
          credentialed={target.credentialed}
          shown={one(sp.shown)?.slice(0, 253) ?? ""}
        />
      ) : (
        <p role="alert">This link is not a web address, so it was not opened.</p>
      )}
    </div>
  );
}
