export type Box = { path: string; specialUse?: string; flags?: Set<string> };

const SENT_NAMES = ["Sent", "Sent Items", "Sent Mail", "INBOX.Sent"];
const JUNK_NAMES = ["Junk", "Spam", "Junk E-mail", "Junk Email", "Bulk Mail", "INBOX.Junk"];

export const selectable = (b: Box) => !b.flags?.has("\\Noselect") && !b.flags?.has("\\NonExistent");

function pick(boxes: Box[], use: string, names: string[]): Box | undefined {
  const ok = boxes.filter(selectable);
  return (
    ok.find((b) => b.specialUse === use) ??
    names
      .map((n) => ok.find((b) => b.path.toLowerCase() === n.toLowerCase()))
      .find((b) => b !== undefined)
  );
}
/** Special-use \Sent, else the first of Sent, Sent Items, Sent Mail, INBOX.Sent. */
export const pickSent = (boxes: Box[]) => pick(boxes, "\\Sent", SENT_NAMES);
export const pickJunk = (boxes: Box[]) => pick(boxes, "\\Junk", JUNK_NAMES);
