import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpOutError, ProviderError, safeRequest } from "../src";

type Seen = { host?: string; url?: string; body: string };
let server: http.Server;
let port = 0;
let connections = 0;
let seen: Seen[] = [];
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
const closed: Promise<void>[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ host: req.headers.host, url: req.url, body });
      handler(req, res);
    });
  });
  server.on("connection", (s) => {
    connections++;
    closed.push(new Promise((r) => s.on("close", () => r())));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  connections = 0;
  seen = [];
  handler = (_q, res) => res.end("ok");
});

const opts = { method: "POST" as const, timeoutMs: 2_000, maxResponseBytes: 64 * 1024 };
const code = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: unknown) => (e instanceof HttpOutError ? e.code : `other: ${String(e)}`),
  );
const to127 = async () => ["127.0.0.1"];

describe("ssrf", () => {
  it.each([
    ["http://127.0.0.1:P/", undefined],
    ["http://169.254.169.254:P/latest", undefined],
    ["http://10.0.0.5:P/", undefined],
    ["http://[::ffff:127.0.0.1]:P/", undefined],
    ["http://mixed.test:P/", async () => ["8.8.8.8", "10.0.0.1"]],
    ["http://2130706433:P/", undefined],
    ["http://0x7f.1:P/", undefined],
    ["http://[::1]:P/", undefined],
    ["http://localhost.:P/", to127],
    ["http://[fd00:ec2::254]:P/", undefined],
    ["http://[::ffff:0:7f00:1]:P/", undefined],
    ["http://[64:ff9b:1::1]:P/", undefined],
    ["http://[2001::1]:P/", undefined],
    ["http://[100::1]:P/", undefined],
    ["http://[2001:db8::1]:P/", undefined],
  ])("allowPrivate false refuses %s with no connection", async (url, resolve) => {
    expect(
      await code(
        safeRequest(url.replace("P", String(port)), { ...opts, allowPrivate: false, resolve }),
      ),
    ).toBe("host_not_public");
    expect(connections).toBe(0);
  });

  it.each([
    "http://169.254.169.254:P/",
    "http://169.254.1.1:P/",
    "http://[fd00:ec2::254]:P/",
    "http://[fe80::1]:P/",
    "http://metadata.google.internal:P/",
  ])("R24: allowPrivate true still refuses metadata %s", async (url) => {
    expect(
      await code(
        safeRequest(url.replace("P", String(port)), {
          ...opts,
          allowPrivate: true,
          resolve: async () => ["169.254.169.254"],
        }),
      ),
    ).toBe("host_not_public");
    expect(connections).toBe(0);
  });

  it("allowPrivate true reaches the checked IP once; Host is the URL host (pinned, no second lookup)", async () => {
    // a second lookup would land on an unroutable address and fail
    const resolve = vi.fn<(h: string) => Promise<string[]>>().mockResolvedValueOnce(["127.0.0.1"]);
    resolve.mockResolvedValue(["10.255.255.1"]);
    const r = await safeRequest(`http://hook.test:${port}/x?y=1`, {
      ...opts,
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
      allowPrivate: true,
      resolve,
    });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe("ok");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("hook.test");
    expect(seen).toEqual([{ host: `hook.test:${port}`, url: "/x?y=1", body: '{"a":1}' }]);
  });

  it("DNS rebinding: the same name turning private on a later lookup is refused before any socket", async () => {
    let n = 0;
    const resolve = async () => (n++ === 0 ? ["127.0.0.1"] : ["10.0.0.1"]);
    const url = `http://rebind.test:${port}/`;
    expect((await safeRequest(url, { ...opts, allowPrivate: true, resolve })).status).toBe(200);
    expect(connections).toBe(1);
    expect(await code(safeRequest(url, { ...opts, allowPrivate: false, resolve }))).toBe(
      "host_not_public",
    );
    expect(connections).toBe(1);
  });

  it("a 302 is returned as-is and never followed", async () => {
    handler = (_q, res) => {
      res.writeHead(302, { location: "http://127.0.0.1/" });
      res.end();
    };
    const r = await safeRequest(`http://hook.test:${port}/`, {
      ...opts,
      allowPrivate: true,
      resolve: to127,
    });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("http://127.0.0.1/");
    expect(seen).toHaveLength(1);
  });

  it.each(["ftp://x/", "http://u:p@x/", "not a url", "file:///etc/passwd"])(
    "%s is bad_url",
    async (url) => {
      expect(await code(safeRequest(url, { ...opts, allowPrivate: true, resolve: to127 }))).toBe(
        "bad_url",
      );
    },
  );

  it("a server that never answers is a timeout within timeoutMs + 100 ms", async () => {
    handler = () => {};
    const t0 = Date.now();
    expect(
      await code(
        safeRequest(`http://hook.test:${port}/`, {
          ...opts,
          timeoutMs: 300,
          allowPrivate: true,
          resolve: to127,
        }),
      ),
    ).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("DNS that never answers is a timeout within timeoutMs + 100 ms", async () => {
    const t0 = Date.now();
    expect(
      await code(
        safeRequest(`http://slow.test:${port}/`, {
          ...opts,
          timeoutMs: 300,
          allowPrivate: true,
          resolve: () => new Promise(() => {}),
        }),
      ),
    ).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("a 2 MB body over a 64 KB cap is response_too_large and the socket is destroyed", async () => {
    handler = (_q, res) => res.end(Buffer.alloc(2 * 1024 * 1024, 120));
    const e = await safeRequest(`http://hook.test:${port}/`, {
      ...opts,
      allowPrivate: true,
      resolve: to127,
    }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpOutError);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({ code: "response_too_large", status: 200 });
    await Promise.race([
      Promise.all(closed),
      new Promise((_, rej) => setTimeout(() => rej(new Error("socket left open")), 1_000)),
    ]);
  });

  it("a refused connection is connect_failed and the message names no body", async () => {
    const free = net.createServer();
    await new Promise<void>((r) => free.listen(0, "127.0.0.1", r));
    const p = (free.address() as AddressInfo).port;
    await new Promise((r) => free.close(r));
    const e = (await safeRequest(`http://hook.test:${p}/`, {
      ...opts,
      allowPrivate: true,
      resolve: to127,
    }).catch((x: unknown) => x)) as HttpOutError;
    expect(e.code).toBe("connect_failed");
    expect(e.message).toBe("http request failed: connect_failed");
  });
});

describe("tls", () => {
  /** A raw TCP listener that records the TLS ClientHello and hangs up. */
  async function hello(url: (p: number) => string) {
    let got = Buffer.alloc(0);
    const s = net.createServer((c) =>
      c.once("data", (d) => {
        got = d;
        c.destroy();
      }),
    );
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const p = (s.address() as AddressInfo).port;
    const c = await code(safeRequest(url(p), { ...opts, allowPrivate: true, resolve: to127 }));
    await new Promise((r) => s.close(r));
    return { c, hello: got.toString("latin1") };
  }

  it("SNI carries a hostname, and no servername is sent for an IP literal", async () => {
    const named = await hello((p) => `https://sni-name.test:${p}/`);
    expect(named.c).toBe("connect_failed");
    expect(named.hello).toContain("sni-name.test");
    const ip = await hello((p) => `https://127.0.0.1:${p}/`);
    expect(ip.c).toBe("connect_failed");
    expect(ip.hello.length).toBeGreaterThan(0);
    expect(ip.hello).not.toContain("127.0.0.1");
  });
});
