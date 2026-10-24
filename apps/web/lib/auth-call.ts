import { APIError } from "better-auth/api";
import { HttpError } from "./api";

/**
 * Runs an in-process `auth.api.*` call and turns its APIError into the HttpError `route()` answers with. `auth` loads
 * on first use, so importing a route (the OpenAPI script) needs no auth environment.
 */
export async function viaAuth<T>(
  call: (api: (typeof import("./auth"))["auth"]["api"]) => Promise<T>,
): Promise<T> {
  try {
    return await call((await import("./auth")).auth.api);
  } catch (e) {
    if (e instanceof APIError)
      throw new HttpError(Number(e.statusCode), e.message || "Request failed");
    throw e;
  }
}
