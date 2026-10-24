import type { Prisma, PrismaClient } from "@rightnow/db/client";
import { z } from "zod";
import { AccountError, isPrismaCode, notFound } from "../accounts/service";
import { audit } from "../audit";
import { RENDER_LEAD_FIELDS } from "../planner";
import { TemplateError, render } from "../template";
import { threadFilterSchema } from "./inbox";

type Db = PrismaClient;
type Actor = string | null | undefined;

const taken = (e: unknown) => {
  if (isPrismaCode(e, "P2002")) throw new AccountError(409, "name_taken");
  throw e;
};

// ---- Notes (PS-INBOX-08): on a thread or on a lead, exactly one
const noteBody = z.string().trim().min(1).max(10_000);
export const noteInput = z
  .strictObject({
    threadId: z.string().min(1).optional(),
    leadId: z.string().min(1).optional(),
    kind: z.enum(["note", "call", "sms", "meeting"]).default("note"), // D41: calls and meetings are logged by hand
    body: noteBody,
  })
  .refine((v) => (v.threadId === undefined) !== (v.leadId === undefined), "threadId or leadId");

export const notePatch = z.strictObject({ body: noteBody });

export const listNotes = (db: Db, ws: string, q: { threadId?: string; leadId?: string }) =>
  db.note.findMany({
    where: {
      workspaceId: ws,
      ...(q.threadId && { threadId: q.threadId }),
      ...(q.leadId && { leadId: q.leadId }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

export async function createNote(db: Db, ws: string, actorId: Actor, input: unknown) {
  const n = noteInput.parse(input);
  const ok = n.threadId
    ? await db.thread.count({ where: { id: n.threadId, workspaceId: ws, deletedAt: null } })
    : await db.lead.count({ where: { id: n.leadId, workspaceId: ws } });
  if (!ok) throw notFound();
  return db.note.create({ data: { ...n, workspaceId: ws, authorId: actorId ?? null } });
}

export async function updateNote(db: Db, ws: string, id: string, input: unknown) {
  const { body } = notePatch.parse(input);
  const r = await db.note.updateMany({ where: { id, workspaceId: ws }, data: { body } });
  if (!r.count) throw notFound();
  return db.note.findUniqueOrThrow({ where: { id } });
}

export async function deleteNote(db: Db, ws: string, id: string) {
  if (!(await db.note.deleteMany({ where: { id, workspaceId: ws } })).count) throw notFound();
}

// ---- Macros (PS-INBOX-09) and saved views (PS-INBOX-07)
const name = z.string().trim().min(1).max(100);
export const macroInput = z.strictObject({ name, body: z.string().min(1).max(10_000) });
export const viewInput = z.strictObject({
  name,
  filters: threadFilterSchema.omit({ cursor: true }),
});

const filtersOf = (f: z.output<typeof viewInput>["filters"]) =>
  f as unknown as Prisma.InputJsonObject;

export const listMacros = (db: Db, ws: string) =>
  db.macro.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" } });
export const listViews = (db: Db, ws: string) =>
  db.inboxView.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" } });

export async function createMacro(db: Db, ws: string, actorId: Actor, input: unknown) {
  const row = await db.macro
    .create({ data: { ...macroInput.parse(input), workspaceId: ws } })
    .catch(taken);
  await audit(db, { workspaceId: ws, actorId }, "macro.create", row.id);
  return row;
}
export async function updateMacro(db: Db, ws: string, actorId: Actor, id: string, input: unknown) {
  const data = macroInput.partial().parse(input);
  if (!(await db.macro.updateMany({ where: { id, workspaceId: ws }, data }).catch(taken)).count)
    throw notFound();
  await audit(db, { workspaceId: ws, actorId }, "macro.update", id);
  return db.macro.findUniqueOrThrow({ where: { id } });
}
export async function deleteMacro(db: Db, ws: string, actorId: Actor, id: string) {
  if (!(await db.macro.deleteMany({ where: { id, workspaceId: ws } })).count) throw notFound();
  await audit(db, { workspaceId: ws, actorId }, "macro.delete", id);
}

export async function createView(db: Db, ws: string, actorId: Actor, input: unknown) {
  const v = viewInput.parse(input);
  const row = await db.inboxView
    .create({ data: { name: v.name, filters: filtersOf(v.filters), workspaceId: ws } })
    .catch(taken);
  await audit(db, { workspaceId: ws, actorId }, "inbox_view.create", row.id);
  return row;
}
export async function updateView(db: Db, ws: string, actorId: Actor, id: string, input: unknown) {
  const v = viewInput.partial().parse(input);
  const data = {
    ...(v.name && { name: v.name }),
    ...(v.filters && { filters: filtersOf(v.filters) }),
  };
  if (!(await db.inboxView.updateMany({ where: { id, workspaceId: ws }, data }).catch(taken)).count)
    throw notFound();
  await audit(db, { workspaceId: ws, actorId }, "inbox_view.update", id);
  return db.inboxView.findUniqueOrThrow({ where: { id } });
}
export async function deleteView(db: Db, ws: string, actorId: Actor, id: string) {
  if (!(await db.inboxView.deleteMany({ where: { id, workspaceId: ws } })).count) throw notFound();
  await audit(db, { workspaceId: ws, actorId }, "inbox_view.delete", id);
}

/** The macro filled in for the thread's lead and sending mailbox: `{text, html}` (the same renderer campaigns use). */
export async function renderMacro(db: Db, ws: string, id: string, threadId: string) {
  const macro = await db.macro.findFirst({ where: { id, workspaceId: ws } });
  const t = await db.thread.findFirst({
    where: { id: threadId, workspaceId: ws, deletedAt: null },
    include: { account: true },
  });
  if (!macro || !t) throw notFound();
  const lead = t.leadId
    ? await db.lead.findFirst({ where: { id: t.leadId, workspaceId: ws } })
    : null;
  const fields: Record<string, string | number | boolean | null> = {};
  if (lead) {
    const custom = lead.customFields;
    if (custom && typeof custom === "object" && !Array.isArray(custom))
      Object.assign(fields, custom as Record<string, string | number | boolean | null>);
    for (const k of RENDER_LEAD_FIELDS) fields[k] = lead[k];
  }
  const ctx = {
    lead: fields,
    sender: {
      firstName: t.account.firstName,
      lastName: t.account.lastName,
      email: t.account.email,
    },
  };
  try {
    return {
      text: render(macro.body, ctx, { seed: threadId, html: false }),
      html: render(macro.body, ctx, { seed: threadId, html: true }),
    };
  } catch (e) {
    if (e instanceof TemplateError)
      throw new AccountError(400, "invalid_template", { issues: e.issues });
    throw e;
  }
}
