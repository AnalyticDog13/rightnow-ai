import { expect, test } from "vitest";
import { VERSION } from "@rightnow/core";

test("exports VERSION", () => {
  expect(VERSION).toBe("0.1.0");
});
