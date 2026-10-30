"use client";

import { Bold, Italic, Link, List, Underline, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./ui/button";

// shortcut: document.execCommand is deprecated but universally supported; replace with an editor library if it breaks.
// The html it produces is untrusted: the server sanitizes it (sanitizeReplyHtml) before it is stored or sent.
const exec = (cmd: string, arg?: string) => document.execCommand(cmd, false, arg);

const TOOLS: [label: string, Icon: LucideIcon, run: () => void][] = [
  ["Bold", Bold, () => exec("bold")],
  ["Italic", Italic, () => exec("italic")],
  ["Underline", Underline, () => exec("underline")],
  ["Bulleted list", List, () => exec("insertUnorderedList")],
  [
    "Link",
    Link,
    () => {
      const url = window.prompt("Link address (https://...)")?.trim();
      if (url && /^(https?:\/\/|mailto:)/i.test(url)) exec("createLink", url);
    },
  ],
];

/** A small contentEditable editor. `value` is html; the editor DOM is only rewritten when `value` changes from outside. */
export function RichText({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (html: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current && box.current.innerHTML !== value) box.current.innerHTML = value;
  }, [value]);
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-sm">
        {label}
      </span>
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5">
        {TOOLS.map(([name, Icon, run]) => (
          <Button
            key={name}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={name}
            title={name}
            // mousedown would move focus out of the editor and lose the selection
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              box.current?.focus();
              run();
              onChange(box.current?.innerHTML ?? "");
            }}
          >
            <Icon aria-hidden />
          </Button>
        ))}
      </div>
      <div
        ref={box}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={`${id}-label`}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="min-h-28 rounded-md border border-input bg-surface p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}
