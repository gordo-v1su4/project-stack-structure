import { describe, expect, test } from "bun:test";

import { resolveSliderUpdate } from "@/components/studio/ParamSlider";

describe("deferred range interaction", () => {
  test("previews Story boundary drag values without publishing until release", () => {
    expect(resolveSliderUpdate({ deferred: true, phase: "input", value: 12.25 })).toEqual({
      previewValue: 12.25,
      publishValue: null,
      retainPreview: true,
    });
    expect(resolveSliderUpdate({ deferred: true, phase: "commit", value: 18.5 })).toEqual({
      previewValue: 18.5,
      publishValue: 18.5,
      retainPreview: true,
    });
  });

  test("keeps existing sliders continuous", () => {
    expect(resolveSliderUpdate({ deferred: false, phase: "input", value: 0.75 })).toEqual({
      previewValue: 0.75,
      publishValue: 0.75,
      retainPreview: false,
    });
  });
});
