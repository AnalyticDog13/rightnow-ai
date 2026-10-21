import { MAX_IMPORT_BYTES } from "@rightnow/core";
import { HttpError } from "./api";

const OVERHEAD = 64 * 1024; // multipart framing and the small text fields

/** Reads a multipart upload. The size is checked from Content-Length BEFORE the body is read; no length means 411. */
export async function readUpload(req: Request, max = MAX_IMPORT_BYTES) {
  const len = Number(req.headers.get("content-length"));
  if (!req.headers.has("content-length") || !Number.isFinite(len))
    throw new HttpError(411, "Content-Length required");
  if (len > max + OVERHEAD) throw new HttpError(413, "File too large");
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Body must be multipart/form-data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  if (file.size > max) throw new HttpError(413, "File too large");
  const json = (k: string): unknown => {
    const v = form.get(k);
    if (typeof v !== "string") return undefined;
    try {
      return JSON.parse(v);
    } catch {
      throw new HttpError(400, `${k} must be JSON`);
    }
  };
  return { fileName: file.name || "upload.csv", data: Buffer.from(await file.arrayBuffer()), json };
}
