import { expect, test } from "vitest";
import { isNumeric } from "../app/(app)/accounts/numeric";

test("isNumeric", () => {
  for (const ok of ["12", "0", "1.5", " 7 "]) expect(isNumeric(ok)).toBe(true);
  for (const bad of ["12abc", "", "   ", "abc", "NaN", "Infinity"])
    expect(isNumeric(bad)).toBe(false);
});
