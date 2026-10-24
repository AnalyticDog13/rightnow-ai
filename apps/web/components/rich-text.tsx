"use client";

import { useEffect, useRef } from "react";
import { Button } from "./ui/button";

// shortcut: document.execCommand is deprecated but universally supported; replace with an editor library if it breaks.
// The html it produces is untrusted: the server sanitizes it (sanitizeReplyHtml) before it is stored or sent.
const exec = (cmd: string, arg?: string) => document.execCommand(cmd, false, arg);

const TOOLS: [label: string, run: () => void][] = [
  ["Bold", () => exec("bold")],
  ["Italic", () => exec("italic")],
  ["Underline", () => exec("underline")],
  ["Bulleted list", () => exec("insertUnorderedList")],
  [
    "Link",
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
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
        {TOOLS.map(([name, run]) => (
          <Button
            key={name}
            type="button"
            variant="outline"
            className="h-8 px-2 text-xs"
            // mousedown would move focus out of the editor and lose the selection
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              box.current?.focus();
              run();
              onChange(box.current?.innerHTML ?? "");
            }}
          >
            {name}
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
        className="min-h-28 rounded-md border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}
