import { getEnv } from "@rightnow/core";
import { getFakeProvider } from "@rightnow/providers";
import { HttpError, route } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

/** Test harness only: 404 unless MAIL_PROVIDER_FAKE=1 (the env refuses that in vps mode). */
export const GET = route({ role: "ADMIN" }, async (c) => {
  if (!getEnv().MAIL_PROVIDER_FAKE) throw new HttpError(404, "Not found");
  let box;
  try {
    box = getFakeProvider(decodeURIComponent(c.params.address!));
  } catch {
    throw new HttpError(404, "Not found"); // invalid address
  }
  const list = async (folder: "INBOX" | "SENT") =>
    (await box.listMessages({ since: new Date(0), folder })).messages.map((m) => ({
      rfcMessageId: m.rfcMessageId,
      subject: m.subject,
      from: m.from,
      to: m.to,
      text: m.text,
      html: m.html,
      headers: m.headers,
    }));
  return { address: box.address, inbox: await list("INBOX"), sent: await list("SENT") };
});
