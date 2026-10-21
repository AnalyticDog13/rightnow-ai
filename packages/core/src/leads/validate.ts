import { createLeadInput } from "./service";

/** Trimmed, lowercased address, or null when it is not a valid email (same rule as createLead). */
export function parseEmail(raw: string): string | null {
  const r = createLeadInput.shape.email.safeParse(raw);
  return r.success ? r.data : null;
}
