"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Callout } from "../../../components/callout";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";

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
  if (cancelled)
    return (
      <Card>
        <p role="status" className="text-sm">
          Cancelled. Nothing was opened. You can close this tab.
        </p>
      </Card>
    );
  return (
    <Card className="flex flex-col gap-4">
      <p role="status" className="text-base font-semibold">
        This link goes to <strong className="font-mono text-base">{host}</strong>
      </p>
      {shown && (
        <p className="text-[13px]/[18px] text-fg-muted">
          The message showed <strong className="font-medium text-fg">{shown}</strong> as the link
          text.
        </p>
      )}
      <p className="rounded-md bg-sunken p-3 font-mono text-[13px]/5 break-all">{url}</p>
      {credentialed && (
        <Callout tone="danger" role="alert">
          This address hides its real destination: the part before the @ is not the site. It goes to{" "}
          {host}. For your safety there is no Continue button for it.
        </Callout>
      )}
      <div className="flex gap-2 max-md:flex-col">
        {!credentialed && (
          <Button asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              Continue
              <ExternalLink aria-hidden />
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
    </Card>
  );
}
