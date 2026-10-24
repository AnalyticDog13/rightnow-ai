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
      className="relative flex gap-2"
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
          className="absolute right-0 top-12 z-10 flex flex-col gap-1 rounded-md border border-border bg-card p-3 text-sm shadow-md"
        >
          <legend className="px-1 font-medium">Show metrics</legend>
          {METRICS.map((m) => (
            <label key={m.id} className="flex items-center gap-2">
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
