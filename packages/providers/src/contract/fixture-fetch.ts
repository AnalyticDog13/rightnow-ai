export type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  order: number;
  concurrency: number; // requests in flight when this one started, including itself
};
type Req = Pick<Call, "method" | "url" | "headers" | "body">;
type Reply = Response | ((req: Req) => Response | Promise<Response>);
export type Route = { method: string; url: string | RegExp } & (
  | { respond: (req: Req) => Response | Promise<Response>; sequence?: never }
  | { sequence: Reply[]; respond?: never }
);

/** A fetch double: first matching route wins; throws on anything unmatched so a stray request fails the test. */
export function createFixtureFetch(routes: Route[]): typeof fetch & { calls: Call[] } {
  const calls: Call[] = [];
  const used = new Map<Route, number>();
  let inFlight = 0;
  const f = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const r = input instanceof Request ? input : undefined;
    const url = r?.url ?? String(input);
    const method = (init?.method ?? r?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers ?? r?.headers).entries());
    const b = init?.body ?? (r ? await r.text() : undefined);
    const body =
      b == null
        ? undefined
        : typeof b === "string"
          ? b
          : Buffer.from(b as ArrayBuffer).toString("utf8");
    const route = routes.find(
      (x) =>
        x.method.toUpperCase() === method &&
        (typeof x.url === "string" ? x.url === url : x.url.test(url)),
    );
    if (!route) throw new Error(`createFixtureFetch: no route for ${method} ${url}`);
    const req = { method, url, headers, body };
    calls.push({ ...req, order: calls.length, concurrency: ++inFlight });
    try {
      if (route.respond) return await route.respond(req);
      const i = used.get(route) ?? 0;
      used.set(route, i + 1);
      const step = route.sequence![i];
      if (!step) throw new Error(`createFixtureFetch: sequence exhausted for ${method} ${url}`);
      return typeof step === "function" ? await step(req) : step;
    } finally {
      inFlight--;
    }
  };
  return Object.assign(f, { calls });
}
