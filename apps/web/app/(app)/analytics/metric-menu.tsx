import { Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { outsideClose } from "./guards";
import { METRICS } from "./metrics-def";

/** The "Metrics" toggle with its checkbox menu; `before` renders in the same row. */
export function MetricMenu({
  hidden,
  toggleMetric,
  before,
}: {
  hidden: string[];
  toggleMetric: (id: string, on: boolean) => void;
  before?: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  // the metric menu closes on an outside click; Escape (below) also returns focus to its button
  useEffect(() => {
    if (!menu) return;
    const away = outsideClose(menuBox.current, () => setMenu(false));
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);
  return (
    <div
      ref={menuBox}
      className="relative flex flex-wrap gap-2 max-md:w-full max-md:[&>*]:flex-1"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !menu) return;
        setMenu(false);
        menuButton.current?.focus();
      }}
    >
      {before}
      <Button
        ref={menuButton}
        variant="outline"
        aria-expanded={menu}
        aria-controls="metric-menu"
        onClick={() => setMenu(!menu)}
      >
        <Settings2 className="size-4" aria-hidden /> Metrics
      </Button>
      {menu && (
        <fieldset
          id="metric-menu"
          className="absolute top-full right-0 z-(--z-popover) mt-1 flex min-w-52 flex-col rounded-md bg-elevated p-1 text-sm shadow-e2"
        >
          <legend className="micro float-left w-full px-2 pt-1.5 pb-1 text-fg-muted">
            Show metrics
          </legend>
          {METRICS.map((m) => (
            <label
              key={m.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 hover:bg-hover md:min-h-8"
            >
              <input
                type="checkbox"
                checked={!hidden.includes(m.id)}
                onChange={(e) => toggleMetric(m.id, e.target.checked)}
              />
              {m.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
