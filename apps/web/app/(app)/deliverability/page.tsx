import Link from "next/link";
import { EmptyState } from "../../../components/empty-state";

export default function Page() {
  return (
    <>
      <EmptyState href="/deliverability" />
      <Link href="/deliverability/placement" className="mt-4 inline-block text-sm underline">
        Inbox placement tests
      </Link>
    </>
  );
}
