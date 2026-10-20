import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeFolder = "INBOX" | "SENT" | "SPAM" | "DRAFT";
export type FakeEntry = {
  seq: number;
  id: string; // providerMessageId
  folder: FakeFolder;
  rfcMessageId: string;
  threadId: string;
  date: string;
  raw: string; // base64 of the RFC 5322 bytes
};
export type FakeMailbox = {
  epoch: number;
  seq: number;
  entries: FakeEntry[];
  removed: { seq: number; id: string; folder: FakeFolder }[];
};

export const fakeMailDir = () => process.env.FAKE_MAIL_DIR || join(tmpdir(), "rightnow-fake-mail");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STALE_LOCK_MS = 30_000;

async function readBox(file: string): Promise<FakeMailbox> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as FakeMailbox;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { epoch: 1, seq: 0, entries: [], removed: [] };
    throw e;
  }
}

/** Lock-free read: writers replace the file atomically by rename. */
export const readMailbox = readBox;

/** Runs `fn` on the mailbox under a `wx` lock file, then writes it back atomically (temp file + rename). */
export async function updateMailbox<T>(file: string, fn: (box: FakeMailbox) => T): Promise<T> {
  await mkdir(join(file, ".."), { recursive: true });
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      await (await open(lock, "wx")).close();
      break;
    } catch (e) {
      // Windows reports EPERM/EACCES while another process's unlink of the lock is pending
      if (!["EEXIST", "EPERM", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
      // a crashed holder must not wedge everyone
      const age = await stat(lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > STALE_LOCK_MS) await unlink(lock).catch(() => {});
      else if (i > 2000) throw new Error(`fake mailbox lock timeout: ${lock}`, { cause: e });
      else await sleep(Math.min(5 + i, 25));
    }
  }
  try {
    const box = await readBox(file);
    const out = fn(box);
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(box));
    for (let i = 0; ; i++) {
      try {
        await rename(tmp, file);
        break;
      } catch (e) {
        // Windows: a concurrent reader can briefly block the replace
        if (
          i >= 20 ||
          !["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")
        )
          throw e;
        await sleep(10);
      }
    }
    return out;
  } finally {
    await unlink(lock).catch(() => {});
  }
}
