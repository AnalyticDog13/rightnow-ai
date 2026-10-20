import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** GET /healthz: 200 when `check` resolves true, 503 otherwise. */
export async function startHealthServer(port: number, check: () => Promise<boolean>) {
  const server: Server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }
    check()
      .catch(() => false)
      .then((ok) => res.writeHead(ok ? 200 : 503).end(ok ? "ok" : "unhealthy"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
