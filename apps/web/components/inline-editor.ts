"use client";

import { useEffect, useRef, useState } from "react";

/**
 * State for an editor that replaces its list in place. Focus goes into the editor when it opens (give its
 * heading `ref={focusOnMount} tabIndex={-1}`) and back to the control that opened it when it closes: mark that
 * control `data-opener={key}`.
 */
export function useInlineEditor<T>() {
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const opener = useRef("");
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !editing)
      document.querySelector<HTMLElement>(`[data-opener="${opener.current}"]`)?.focus();
    wasOpen.current = !!editing;
  }, [editing]);
  return {
    editing,
    open: (what: T | "new", key: string) => {
      opener.current = key;
      setEditing(what);
    },
    close: () => setEditing(null),
  };
}

export const focusOnMount = (el: HTMLElement | null) => el?.focus();
