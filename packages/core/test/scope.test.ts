import { expect, test } from "vitest";
import { scopeAllows } from "../src/apikeys";

test("scopeAllows", () => {
  for (const v of ["create", "update", "delete"])
    expect(scopeAllows(["accounts:write"], `accounts:${v}`)).toBe(true);
  expect(scopeAllows(["accounts:write"], "accounts:read")).toBe(false);
  expect(scopeAllows(["accounts:write"], "accounts:export")).toBe(false); // a future verb needs its own scope
  expect(scopeAllows(["leads:write"], "accounts:update")).toBe(false);
  expect(scopeAllows(["accounts:read"], "accounts:update")).toBe(false);
  expect(scopeAllows(["accounts:read"], "accounts:read")).toBe(true);
  expect(scopeAllows(["accounts:all"], "accounts:export")).toBe(true);
  expect(scopeAllows(["all:all"], "leads:read")).toBe(true);
});
