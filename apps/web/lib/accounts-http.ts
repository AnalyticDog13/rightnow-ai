import { AccountError, systemClock } from "@rightnow/core";
import { HttpError, type Role } from "./api";

/** Service options for a request (actor for the audit row, role for admin-only fields). */
export const actor = (c: { userId?: string; role: Role }) => ({
  clock: systemClock,
  actorId: c.userId,
  role: c.role,
});

/** Maps AccountError to the API's error shape; an error that carries a body (diagnostics) keeps it. */
export async function run<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    if (e.body && typeof e.body === "object")
      return Response.json({ error: e.message, ...e.body }, { status: e.status });
    throw new HttpError(e.status, e.message);
  }
}
