// Quoted-reply markers: Gmail/Apple "On … wrote:", Outlook "-----Original Message-----" or "From: … Sent:".
const MARKER = new RegExp(
  [
    String.raw`On\b[^\n]{0,200}\n?[^\n]{0,100}wrote:[ \t]*$`,
    String.raw`-{2,}\s*(?:Original Message|Urspr\S* Nachricht|Message d'origine|Mensaje original)\s*-{2,}`,
    // Outlook header block in English, German, Spanish, French
    String.raw`(?:From|Von|De|Da)\s?:[^\n]*\n(?:[^\n]*\n){0,2}?[ \t]*(?:Sent|Gesendet|Enviado|Enviada|Envoy\S*)\s?:`,
    // any other block of 3+ consecutive "Word:" header lines
    String.raw`[\p{L}-]{2,20}\s?:[^\n]*(?:\n[ \t]*[\p{L}-]{2,20}\s?:[^\n]*){2}`,
  ]
    .map((p) => String.raw`^[ \t]*(?:${p})`)
    .join("|"),
  "imu",
);

/** Drops everything from the first quoted-reply marker on, and every ">" line before it. */
export function stripQuoted(text: string): string {
  const cut = MARKER.exec(text);
  const head = cut ? text.slice(0, cut.index) : text;
  return head
    .split("\n")
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n")
    .trim();
}
