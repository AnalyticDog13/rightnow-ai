"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button";

export function LinkCheck({
  url,
  host,
  shown,
  credentialed,
}: {
  url: string;
  host: string;
  shown: string;
  credentialed: boolean;
}) {
  const [cancelled, setCancelled] = useState(false);
  if (cancelled) return <p role="status">Cancelled. Nothing was opened. You can close this tab.</p>;
  return (
    <>
      <p role="status" className="text-lg">
        This link goes to <strong>{host}</strong>
      </p>
      {shown && (
        <p className="text-sm text-muted-foreground">
          The message showed <strong>{shown}</strong> as the link text.
        </p>
      )}
      <p className="break-all rounded-md border border-border bg-card p-3 text-sm">{url}</p>
      {credentialed && (
        <p role="alert" className="text-sm font-medium">
          This address hides its real destination: the part before the @ is not the site. It goes to{" "}
          {host}. For your safety there is no Continue button for it.
        </p>
      )}
      <div className="flex gap-2">
        {!credentialed && (
          <Button asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Continue
            </a>
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setCancelled(true);
            window.close(); // works only for a tab the app opened; the text above covers the rest
          }}
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
