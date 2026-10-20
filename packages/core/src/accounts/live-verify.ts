import { newMessageId, type MailProvider, type SyncCursor } from "@rightnow/providers";
import type { Clock } from "../clock";

export type VerifyStep = { step: string; ok: boolean; detail?: string };
const WAIT_MS = 60_000;
const POLL_MS = 2_000;
const msg = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Real-mailbox smoke run for scripts/live-verify.ts. A failed send ends the run; diagnostics and the later checks still report. */
export async function liveVerify(
  provider: MailProvider,
  to: string,
  clock: Clock,
): Promise<VerifyStep[]> {
  const out: VerifyStep[] = [];
  const started = Date.now();
  // returns undefined (and records the failure) when the step throws or reports not ok
  const step = async <T>(
    name: string,
    fn: () => Promise<{ ok: boolean; detail?: string; value?: T }>,
  ) => {
    try {
      const r = await fn();
      out.push({ step: name, ok: r.ok, detail: r.detail });
      return r.ok ? r.value : undefined;
    } catch (e) {
      out.push({ step: name, ok: false, detail: msg(e) });
    }
  };

  await step("diagnostics", async () => {
    const d = await provider.diagnostics();
    return {
      ok: d.ok,
      detail:
        d.checks
          .filter((c) => !c.ok)
          .map((c) => `${c.name}:${c.code ?? "failed"}`)
          .join(", ") || undefined,
    };
  });

  let cursor: SyncCursor | undefined;
  try {
    cursor = await provider.currentCursor(); // before the send, so the sent copy shows up in "changes"
  } catch {
    /* reported in the cursor step */
  }
  const messageId = newMessageId(provider.address.split("@").pop()!);
  const sent = await step("send", async () => {
    const r = await provider.send({
      from: { email: provider.address },
      to: [{ email: to }],
      subject: "RightNow live verification",
      text: "Live verification message from RightNow. Safe to delete.",
      messageId,
      headers: { "X-RightNow-Test": "1" },
    });
    return {
      ok: true,
      detail:
        r.rfcMessageId === messageId
          ? "Message-ID kept"
          : `Message-ID changed to ${r.rfcMessageId}`,
      value: r,
    };
  });
  if (!sent) return out;

  await step("findSent", async () => {
    const m = await provider.findSent(messageId, { providerMessageId: sent.providerMessageId });
    return { ok: !!m && !m.headers.bcc?.length, detail: m ? undefined : "not found in Sent" };
  });
  await step("locate", async () => {
    const l = await provider.locate(messageId);
    return { ok: l?.folder === "SENT", detail: l ? l.folder : "not found" };
  });
  await step("cursor", async () => ({ ok: !!cursor, detail: cursor?.kind }));
  if (!cursor) return out;

  await step("changes", async () => {
    const deadline = clock.now().getTime() + WAIT_MS;
    for (let c: SyncCursor = cursor!; ;) {
      const r = await provider.listChangesSince(c);
      if (r.expired) return { ok: false, detail: "cursor expired" };
      if (r.messages.some((m) => m.rfcMessageId === messageId && m.folder === "SENT"))
        return { ok: true };
      c = r.cursor;
      if (!r.hasMore) {
        if (clock.now().getTime() >= deadline)
          return { ok: false, detail: "sent copy not seen within 60 s" };
        await new Promise((res) => setTimeout(res, POLL_MS));
        // a fixed test clock never reaches the deadline: bound by wall time too
        if (Date.now() - started > WAIT_MS)
          return { ok: false, detail: "sent copy not seen within 60 s" };
      }
    }
  });
  return out;
}
