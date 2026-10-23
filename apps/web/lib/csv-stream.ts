/** Pulls one CSV chunk per read, so a large export never sits in memory. */
export function csvStream(chunks: AsyncIterable<string>) {
  const it = chunks[Symbol.asyncIterator]();
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      try {
        const r = await it.next();
        if (r.done) ctl.close();
        else ctl.enqueue(enc.encode(r.value));
      } catch (e) {
        // the 200 and the first rows are already sent: say so in the file rather than end it silently
        console.error("csv export failed", e);
        ctl.enqueue(enc.encode("# export failed: incomplete file\r\n"));
        ctl.close();
      }
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
