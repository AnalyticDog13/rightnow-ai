import { audit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { generateId } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { HttpError, route } from "../../../../lib/api";
import { getWebEnv } from "../../../../lib/env";
import { clientIp, limitOrThrow } from "../../../../lib/ratelimit";

const body = z.strictObject({
  invitationId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(128),
});
const ROLES = ["admin", "member", "viewer"];

type InvitationRow = {
  id: string;
  workspaceId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
};

/**
 * D50, public: the invitation id is the secret. In one transaction the invitation is locked and the user is created with
 * the INVITED email (never one from the body), so a link cannot be used for another address. The role is never `owner`.
 */
export const POST = route({ auth: "public", body }, async ({ body, req }) => {
  await limitOrThrow("invite", `ip:${clientIp(req, getWebEnv().MODE)}`, 10, 900);
  const password = await hashPassword(body.password);
  try {
    await prisma.$transaction(async (tx) => {
      const [inv] = await tx.$queryRaw<
        InvitationRow[]
      >`SELECT * FROM "Invitation" WHERE id = ${body.invitationId} FOR UPDATE`;
      if (!inv) throw new HttpError(404, "invite_not_found");
      if (inv.status !== "pending") throw new HttpError(409, "invite_used");
      if (inv.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "invite_expired");
      const email = inv.email.toLowerCase();
      const old = await tx.user.findUnique({
        where: { email },
        select: { id: true, _count: { select: { members: true } } },
      });
      if (old && old._count.members > 0) throw new HttpError(409, "user_exists");
      // a user left without any membership (a removal that stopped half way) must not block the address
      if (old) await tx.user.delete({ where: { id: old.id } });
      const user = await tx.user.create({ data: { id: generateId(), name: body.name, email } });
      await tx.account.create({
        data: {
          id: generateId(),
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password,
        },
      });
      const role = ROLES.includes(inv.role ?? "") ? inv.role! : "member";
      const m = await tx.member.create({
        data: { id: generateId(), workspaceId: inv.workspaceId, userId: user.id, role },
      });
      await tx.invitation.update({ where: { id: inv.id }, data: { status: "accepted" } });
      await audit(tx, { workspaceId: inv.workspaceId, actorId: user.id }, "member.join", m.id, {
        role,
      });
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "user_exists");
    throw e;
  }
});
