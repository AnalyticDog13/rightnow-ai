import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// organization endpoints are disabled over HTTP (lib/auth.ts); members go through /api/v1/members and /invites
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
