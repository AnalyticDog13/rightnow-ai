declare module "hoodiecrow-imap" {
  import type { Server } from "node:net";
  type IMAPServer = Server & { users: Record<string, { password: string }> };
  export default function hoodiecrow(options?: Record<string, unknown>): IMAPServer;
}
