import { FakeProvider } from "./provider";
import { fakeMailDir } from "./store";
import type { ProviderKind } from "../types";

const providers = new Map<string, FakeProvider>();

/** One FakeProvider per (dir, address) per process, so `failNext` set by a test reaches the code under test. Used by core's createProvider when MAIL_PROVIDER_FAKE=1. */
export function getFakeProvider(address: string, kind?: ProviderKind): FakeProvider {
  const key = `${fakeMailDir()}|${address.toLowerCase()}`;
  let p = providers.get(key);
  if (!p) providers.set(key, (p = new FakeProvider(address, { kind })));
  return p;
}
