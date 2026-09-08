import { describe, expect, test } from "bun:test";
import { assertReferenceLanguage, checkReferenceLanguage, referenceAwareCaption } from "@/components/studio/referenceLanguage";
import { normalizeServerCaptionPayload } from "@/components/studio/sceneCaptioningServer";

describe("reference language", () => {
  test("names repeat without changing clothing actions", () => {
    for (const text of ["Diego runs. Diego turns toward Valentina.", "Diego's shirt tears as Diego climbs.", "Diego pulls off Diego's shirt.", "Valentina rips the fabric free while Diego holds the door."]) {
      expect(checkReferenceLanguage(text, ["Diego", "Valentina"])).toEqual([]);
      expect(referenceAwareCaption(text, ["Diego", "Valentina"])).toBe(text);
    }
  });
  test("flags pronouns instead of guessing the actor", () => {
    const text = "Diego faces Valentina. He runs and she follows him.";
    expect(checkReferenceLanguage(text, ["Diego", "Valentina"]).map(issue => issue.text)).toEqual(["He", "she", "him"]);
    expect(referenceAwareCaption(text, ["Diego", "Valentina"])).toBe(text);
    expect(() => assertReferenceLanguage(text)).toThrow("exact character name");
  });
  test("static descriptions and sensitive adjectives require review, never a new outfit", () => {
    expect(checkReferenceLanguage("Diego is shirtless and dances.").map(issue => issue.kind)).toEqual(["appearance"]);
    expect(checkReferenceLanguage("Diego in a red shirt runs.")[0]?.kind).toBe("appearance");
    expect(checkReferenceLanguage("Diego dances in a sensual way.")[0]?.kind).toBe("sensitive-wording");
    expect(referenceAwareCaption("Diego, shirtless, dances.", ["Diego"])).toBe("Diego dances.");
  });
  test("caption normalization preserves the action and unrelated observations", () => {
    expect(normalizeServerCaptionPayload({ text: "Diego, in a red plaid shirt, turns toward Valentina." }, ["Diego", "Valentina"]).text).toBe("Diego turns toward Valentina.");
    const action = "Diego, in a shirt tearing at the sleeve, runs.";
    expect(referenceAwareCaption(action, ["Diego"])).toBe(action);
    expect(referenceAwareCaption("Diego, wearing a shirt and waving, runs.", ["Diego"])).toBe("Diego, wearing a shirt and waving, runs.");
    expect(checkReferenceLanguage("A red door opens into the club.")).toEqual([]);
  });
});
