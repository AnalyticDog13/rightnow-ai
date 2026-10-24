import { getEnv, outEnv as fromEnv } from "@rightnow/core";

/** How a webhook URL is checked and reached (D44): private hosts only with ALLOW_PRIVATE_HTTP_HOSTS=1. */
export const outEnv = () => fromEnv(getEnv());
