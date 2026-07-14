import { describe, expect, test } from "bun:test";

import { dataUrlToFile } from "@/trigger/localGeneration";

describe("Trigger local generation assets", () => {
  test("decodes base64 data URLs with the native Buffer path", async () => {
    const file = dataUrlToFile("data:image/png;base64,AQIDBA==", "generated");

    expect(file.name).toBe("generated.png");
    expect(file.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  test("decodes percent-encoded base64 payloads before converting them", async () => {
    const file = dataUrlToFile("data:application/octet-stream;base64,%2B%2B8%3D", "generated");

    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([251, 239]);
  });

  test("decodes percent-encoded data URLs", async () => {
    const file = dataUrlToFile("data:text/plain,hello%20world", "generated");

    expect(file.name).toBe("generated.bin");
    expect(await file.text()).toBe("hello world");
  });
});
