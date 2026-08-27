import { describe, expect, test } from "bun:test";

import { parseDurableCaptionReferences } from "@/lib/captionReferences";

describe("durable caption references", () => {
  test("accepts two character identities plus one named environment", () => {
    const references = parseDurableCaptionReferences([
      { name: "Diego", role: "primary", bucket: "stack-structure", objectKey: "refs/diego.png" },
      { name: "Valentina", role: "secondary", bucket: "stack-structure", objectKey: "refs/valentina.png" },
      { name: "The Ember Ballroom", role: "environment", bucket: "stack-structure", objectKey: "refs/ember-ballroom.png" },
    ], "stack-structure");

    expect(references.map((reference) => reference.role)).toEqual(["primary", "secondary", "environment"]);
    expect(references[2]?.name).toBe("The Ember Ballroom");
  });

  test("rejects more than the supported three durable images", () => {
    let message = "";
    try {
      parseDurableCaptionReferences([
        { name: "One", role: "primary", bucket: "stack-structure", objectKey: "refs/one.png" },
        { name: "Two", role: "secondary", bucket: "stack-structure", objectKey: "refs/two.png" },
        { name: "Place", role: "environment", bucket: "stack-structure", objectKey: "refs/place.png" },
        { name: "Extra", role: "environment", bucket: "stack-structure", objectKey: "refs/extra.png" },
      ], "stack-structure");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("at most two character images and one environment image");
  });
});
