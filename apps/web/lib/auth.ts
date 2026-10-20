import { audit } from "@rightnow/core";
import { prisma } from "@rightnow/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins/organization";
import { adminAc, defaultAc, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { getWebEnv } from "./env";

const env = getWebEnv();

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Sign-up is closed: the first owner is created by /api/setup (lib/setup.ts), everyone else by invite.
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: { "/sign-in/email": { window: 60, max: 5 } },
  },
  databaseHooks: {
    session: {
      // PS-SEC-07: every sign-in is audited. A failing audit write must not lock users out.
      create: {
        after: async (session) => {
          try {
            const m = await prisma.member.findFirst({
              where: { userId: session.userId },
              orderBy: { createdAt: "asc" },
              select: { workspaceId: true },
            });
            if (m)
              await audit(
                prisma,
                { workspaceId: m.workspaceId, actorId: session.userId },
                "auth.sign_in",
              );
          } catch (e) {
            console.error("audit sign-in failed", e);
          }
        },
      },
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false, // workspaces are created only by /api/setup
      disableOrganizationDeletion: true, // deleting the only workspace cascades everything and locks the owner out
      // Workspace = better-auth organization.
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
    }),
  ],
});
