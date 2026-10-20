import Link from "next/link";
import { EmptyState } from "../../../components/empty-state";

export default function Page() {
  return (
    <>
      <EmptyState href="/settings" />
      <p className="mt-4 text-sm">
        <Link className="text-primary underline" href="/settings/api-keys">
          API keys
        </Link>
      </p>
    </>
  );
}
