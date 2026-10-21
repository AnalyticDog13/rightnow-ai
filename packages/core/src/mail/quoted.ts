// Quoted-reply markers: Gmail/Apple "On … wrote:", Outlook "-----Original Message-----" or "From: … Sent:".
const MARKER =
  /^[ \t]*(?:On\b[^\n]{0,200}\n?[^\n]{0,100}wrote:[ \t]*$|-{2,}\s*Original Message\s*-{2,}|From:[^\n]*\n(?:[^\n]*\n){0,2}?[ \t]*Sent:)/im;

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
