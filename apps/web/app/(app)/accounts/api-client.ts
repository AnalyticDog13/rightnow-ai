/** JSON call to the accounts API; resolves to the parsed body, or an error text. */
export async function call(url: string, method: string, body?: unknown, signal?: AbortSignal) {
  const res = await fetch(url, {
    method,
    signal,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  const json = (await res?.json().catch(() => ({}))) as Record<string, unknown> | undefined;
  return { ok: !!res?.ok, status: res?.status ?? 0, json: json ?? {} };
}
export const errorText = (r: { json: Record<string, unknown> }) =>
  typeof r.json.error === "string" ? r.json.error : "Something went wrong";
