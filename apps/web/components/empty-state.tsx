import { NAV } from "../lib/nav";
import { Card } from "./ui/card";

export function EmptyState({ href }: { href: string }) {
  const item = NAV.find((n) => n.href === href)!;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
      <Card className="mt-6 flex flex-col items-center gap-3 py-16 text-center">
        <item.icon className="size-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-medium">Nothing here yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {item.label} is not built yet. It arrives in {item.arrives}.
        </p>
      </Card>
    </div>
  );
}
