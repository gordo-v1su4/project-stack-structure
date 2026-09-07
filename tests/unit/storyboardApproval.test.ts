import { describe, expect, test } from "bun:test";
import { validateStoryboardJob } from "@/lib/storyboardApproval";
import { acceptedFreshFrame } from "../helpers/storyboardFrame";

describe("manual image return placement identity", () => {
  test("preserves current identity while allowing legacy results to return for explicit review", () => {
    const job = { ...acceptedFreshFrame().storyboard!, references: [
      { url: "https://media.example/diego.png", label: "Diego", role: "character-1" },
      { url: "https://media.example/panel.png", label: "Panel 5", role: "composition" },
    ] };
    const current = validateStoryboardJob(job, ["media.example"]);
    expect(current.planSignature).toBe("plan-current");
    expect(current.requirementId).toBe("dance");
    const legacy = validateStoryboardJob({ ...job, planSignature: undefined, requirementId: undefined }, ["media.example"]);
    expect(legacy.planSignature).toBe(undefined);
    expect(legacy.sourceGridId).toBe("grid");
    expect(() => validateStoryboardJob({ ...job, planSignature: {} }, ["media.example"])).toThrow("Invalid planSignature");
  });
});
