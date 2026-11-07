import { expect, test } from "bun:test";
import { ProjectSaveSession } from "@/components/studio/projectSaveSession";

test("one editor serializes saves and advances only its own acknowledged revision", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  const bases: unknown[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = editor.save("film", async base => { bases.push(base); await gate; return { project: { id: "film" }, revision: "v2" }; });
  const second = editor.save("film", async base => { bases.push(base); return { project: { id: "film" }, revision: "v3" }; });
  await Promise.resolve(); expect(bases).toEqual(["v1"]);
  release(); await Promise.all([first, second]); expect(bases).toEqual(["v1", "v2"]);
});

test("an obsolete tab cannot auto-rebase or replay after a conflict", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "old");
  let calls = 0;
  const write = async () => { calls++; throw new Error("Another window changed this project."); };
  await expect(editor.save("film", write)).rejects.toThrow("Automatic saving is paused");
  await expect(editor.save("film", write)).rejects.toThrow("Automatic saving is paused");
  expect(calls).toBe(1);
  editor.restore("film", "fresh");
  await editor.save("film", async base => { expect(base).toBe("fresh"); return { project: { id: "film" }, revision: "next" }; });
});

test("a project switch rejects queued snapshots and ignores the old flight's ACK", async () => {
  const editor = new ProjectSaveSession(); editor.restore("first", "a1");
  const epoch = editor.contextEpoch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const flight = editor.save("first", async () => { await gate; return { project: { id: "first" }, revision: "a2" }; });
  const flightResult = flight.then(() => null, error => error as Error);
  const queued = editor.save("first", async () => { throw new Error("must not write"); }, epoch);
  const queuedResult = queued.then(() => null, error => error as Error);
  await Promise.resolve(); editor.restore("second", "b1"); release();
  expect((await flightResult)?.message).toContain("old acknowledgment was not applied");
  expect((await queuedResult)?.message).toContain("obsolete snapshot was not written");
  await editor.save("second", async base => { expect(base).toBe("b1"); return { project: { id: "second" }, revision: "b2" }; });
});

test("restoring the same project invalidates older queued work too", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1"); const epoch = editor.contextEpoch;
  editor.restore("film", "remote-v2");
  await expect(editor.save("film", async () => { throw Error("must not write"); }, epoch)).rejects.toThrow("obsolete snapshot was not written");
});

test("an uncertain ACK holds writes until explicit reconciliation", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1"); let calls = 0;
  await expect(editor.save("film", async () => { calls++; throw Error("Connection lost"); })).rejects.toThrow("Reopen the saved project");
  await expect(editor.save("film", async () => { calls++; return { project: { id: "film" }, revision: "v2" }; })).rejects.toThrow("Connection lost");
  expect(calls).toBe(1);
});

test("missing revision and missing ACK revision both fail closed", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film");
  await expect(editor.save("film", async () => { throw Error("must not write"); })).rejects.toThrow("no saved revision");
  editor.restore("film", "v1");
  await expect(editor.save("film", async () => ({ project: { id: "film" } }))).rejects.toThrow("acknowledgment has no revision");
});
