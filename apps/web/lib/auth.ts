import { audit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import { adminAc, defaultAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { twoFactor } from "better-auth/plugins/two-factor";
import { getWebEnv } from "./env";

const env = getWebEnv();

/** PS-SEC-07: audit under the user's workspace (single-workspace deployment: their first membership). */
async function auditUser(userId: string, action: string) {
  try {
    const m = await prisma.member.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { workspaceId: true },
    });
    if (m) await audit(prisma, { workspaceId: m.workspaceId, actorId: userId }, action);
  } catch (e) {
    console.error(`audit ${action} failed`, e); // a failing audit write must not lock users out
  }
}

// Workspace = better-auth organization. D50/R21: members are invited, re-roled and removed only through our routes
// (they call auth.api.* in-process and audit); the same endpoints over HTTP are all disabled below.
const workspaces = organization({
  allowUserToCreateOrganization: false, // workspaces are created only by /api/setup
  disableOrganizationDeletion: true, // deleting the only workspace cascades everything and locks the owner out
  invitationExpiresIn: 7 * 24 * 3600,
  schema: {
    organization: { modelName: "workspace" },
    member: { fields: { organizationId: "workspaceId" } },
    invitation: { fields: { organizationId: "workspaceId" } },
  },
  roles: {
    owner: ownerAc,
    admin: adminAc,
    member: memberAc,
    viewer: defaultAc.newRole({ organization: [] }),
  },
});

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Sign-up is closed: the first owner is created by /api/setup (lib/setup.ts), everyone else by invite.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  // D49: the Postgres buckets in app/api/auth/[...all]/route.ts replace the in-memory limiter (one mechanism)
  rateLimit: { enabled: false },
  appName: "rightnow", // the issuer shown in authenticator apps
  // every /organization/* endpoint: includes `leave` (the OWNER would orphan the workspace) and the unaudited
  // invite, accept, role-change and remove ones
  disabledPaths: Object.values(workspaces.endpoints).map((e) => e.path),
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.context.returned instanceof Error) return;
      const user = ctx.context.session?.user;
      if (!user) return;
      // enabling is the first TOTP verify made with a session (at sign-in there is none) while 2FA is still off
      if (ctx.path === "/two-factor/verify-totp" && !user.twoFactorEnabled)
        await auditUser(user.id, "auth.2fa_enable");
      if (ctx.path === "/two-factor/disable") await auditUser(user.id, "auth.2fa_disable");
    }),
  },
  plugins: [
    workspaces,
    twoFactor(),
    // PS-SEC-07: a sign-in is audited once a usable session exists. Listed after twoFactor so its hook has already
    // cleared `newSession` while a code is pending; the code check then creates the session. Enabling or disabling 2FA
    // re-creates the session and is not a sign-in.
    {
      id: "audit-sign-in",
      hooks: {
        after: [
          {
            matcher: (c) =>
              c.path === "/sign-in/email" ||
              (c.path?.startsWith("/two-factor/verify-") === true && !c.context?.session),
            handler: createAuthMiddleware(async (ctx) => {
              const user = ctx.context.newSession?.user;
              if (user && !(ctx.context.returned instanceof Error))
                await auditUser(user.id, "auth.sign_in");
            }),
          },
        ],
      },
    },
  ],
});
