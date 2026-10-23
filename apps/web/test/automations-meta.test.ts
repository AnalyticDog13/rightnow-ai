import { ACTIONS, TRIGGERS } from "@rightnow/core";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  TRIGGERS as CLIENT_TRIGGERS,
  toAction,
  toDraft,
} from "../app/(app)/automations/rule-meta";

describe("rule editor tables", () => {
  it("name exactly the triggers and actions the engine has", () => {
    expect(Object.keys(CLIENT_TRIGGERS).sort()).toEqual(Object.keys(TRIGGERS).sort());
    expect(Object.keys(ACTION_TYPES).sort()).toEqual(Object.keys(ACTIONS).sort());
  });

  it("pass an action type the client does not know through unchanged", () => {
    const hook = { type: "send_webhook", webhookId: "w1", extra: { a: 1 } };
    expect(toAction(toDraft(hook))).toEqual(hook);
    const task = { type: "create_task", title: "Call", dueInDays: 2 };
    expect(toAction(toDraft(task))).toEqual(task);
  });
});
