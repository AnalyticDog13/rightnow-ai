import { createHash } from "node:crypto";
import type { PrismaClient } from "@rightnow/db/client";
import type { Clock } from "./clock";
import { setCredentials } from "./accounts/credentials";
import { openAccount } from "./accounts/open-account";
import { decrypt } from "./crypto";

// PS-DEPLOY-11 fixture, seeded before a backup and verified after a restore (CI compose-smoke).
const SLUG = "migration-check";
const EMAIL = "mig@migration-check.test";
const ACCESS = "mig-access";
const bytes = () => Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * Idempotent. The account is NEEDS_ATTENTION and status ERROR so no worker job contacts a provider for it:
 * mail sync skips NEEDS_ATTENTION, push renew needs CONNECTED, autofix skips NEEDS_ATTENTION, warm-up skips both.
 */
export async function seedMigrationFixture(prisma: PrismaClient, clock: Clock): Promise<void> {
  const ws = await prisma.workspace.upsert({
    where: { slug: SLUG },
    update: {},
    create: { name: "Migration check", slug: SLUG },
  });
  if (await prisma.emailAccount.findFirst({ where: { workspaceId: ws.id, email: EMAIL } })) return;
  const id = await prisma.$transaction((tx) =>
    openAccount(tx, clock, ws.id, {
      provider: "GMAIL",
      email: EMAIL,
      capTier: "GMAIL_CONSUMER",
      providerCap: 500,
      appendToSent: false,
      fromName: "Migration",
      firstName: "Mig",
      lastName: "Check",
    }),
  );
  if (!id) throw new Error("migration fixture account could not be created");
  await setCredentials(
    prisma,
    ws.id,
    id,
    {
      kind: "oauth",
      accessToken: ACCESS,
      refreshToken: "mig-refresh",
      expiresAt: clock.now().getTime() + 3_600_000,
      scope: "s",
    },
    { lifecycle: "NEEDS_ATTENTION", status: "ERROR" },
  );
  await prisma.thread.create({
    data: {
      workspaceId: ws.id,
      accountId: id,
      subject: "migration check",
      lastMessageAt: clock.now(),
      messages: {
        create: {
          workspaceId: ws.id,
          accountId: id,
          rfcMessageId: "<migration-check@migration-check.test>",
          direction: "IN",
          folder: "INBOX",
          fromEmail: "sender@migration-check.test",
          to: [EMAIL],
          subject: "migration check",
          sentAt: clock.now(),
          kind: "OTHER",
          attachments: {
            create: {
              filename: "fixture.bin",
              contentType: "application/octet-stream",
              size: 4096,
              data: bytes(),
            },
          },
        },
      },
    },
  });
}

/** Throws unless the seeded rows survived and still decrypt under `key` (default: ENCRYPTION_KEY). Messages never carry credential values. */
export async function verifyMigrationFixture(prisma: PrismaClient, key?: Buffer): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { slug: SLUG } });
  const acc =
    ws && (await prisma.emailAccount.findFirst({ where: { workspaceId: ws.id, email: EMAIL } }));
  if (!acc?.credentialsEnc) throw new Error("migration fixture account or credentials missing");
  let token: string | undefined;
  try {
    token = (JSON.parse(decrypt(acc.credentialsEnc, key)) as { accessToken?: string }).accessToken;
  } catch {
    throw new Error("migration fixture credentials do not decrypt with this ENCRYPTION_KEY");
  }
  if (token !== ACCESS) throw new Error("migration fixture credentials decrypt to the wrong value");
  const att = await prisma.attachment.findFirst({
    where: { message: { accountId: acc.id, thread: { accountId: acc.id } } },
  });
  if (!att?.data) throw new Error("migration fixture attachment missing");
  if (sha(att.data) !== sha(bytes()))
    throw new Error("migration fixture attachment checksum mismatch");
}
