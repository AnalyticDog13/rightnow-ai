/** Pulls one CSV chunk per read, so a large export never sits in memory. */
export function csvStream(chunks: AsyncIterable<string>) {
  const it = chunks[Symbol.asyncIterator]();
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      const r = await it.next();
      if (r.done) ctl.close();
      else ctl.enqueue(enc.encode(r.value));
    },
    cancel: () => void it.return?.(),
  });
}

export const csvResponse = (chunks: AsyncIterable<string>, filename: string) =>
  new Response(csvStream(chunks), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
