import { systemResolver } from "@rightnow/core";

/** The resolver every route uses; a module of its own so tests can replace it (no network in tests). */
export const resolver = systemResolver;
