import { expect, test } from "bun:test";
import { ProjectSaveConflictError, ProjectSaveSession } from "@/components/studio/projectSaveSession";

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

test("same-project edits during a derived snapshot save hold later autosaves until reconciliation", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  let current = true, calls = 0;
  await expect(editor.save("film", async () => {
    calls++; current = false; return { project: { id: "film" }, revision: "confirmed-v2" };
  }, editor.contextEpoch, () => current)).rejects.toThrow("reconcile both versions");
  await expect(editor.save("film", async () => { calls++; return { project: { id: "film" }, revision: "must-not-write" }; })).rejects.toThrow("reconcile both versions");
  expect(calls).toBe(1);
  editor.restore("film", "confirmed-v2");
  await editor.save("film", async base => { expect(base).toBe("confirmed-v2"); return { project: { id: "film" }, revision: "v3" }; });
});

test("an already obsolete prepared snapshot performs no write and does not block current edits", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  await expect(editor.save("film", async () => { throw Error("must not write"); }, editor.contextEpoch, () => false)).rejects.toThrow("prepared snapshot was not written");
  await editor.save("film", async base => { expect(base).toBe("v1"); return { project: { id: "film" }, revision: "v2" }; });
});

test("Save as preserves a conflicted window under a new ID and fences queued original saves", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "old");
  await expect(editor.save("film", async () => { throw new ProjectSaveConflictError("Another window changed this project."); })).rejects.toThrow("Save as a new project");
  const epoch = editor.contextEpoch;
  let originalWrites = 0;
  const copy = editor.save(null, async base => {
    expect(base).toBe(undefined); return { project: { id: "recovery-copy" }, revision: "copy-v1" };
  });
  const queued = editor.save("film", async () => { originalWrites++; return { project: { id: "film" }, revision: "wrong" }; }, epoch);
  const queuedResult = queued.then(() => null, error => error as Error);
  expect((await copy).project.id).toBe("recovery-copy");
  expect((await queuedResult)?.message).toContain("obsolete snapshot was not written");
  expect(originalWrites).toBe(0);
  await editor.save("recovery-copy", async base => {
    expect(base).toBe("copy-v1"); return { project: { id: "recovery-copy" }, revision: "copy-v2" };
  });
});

test("an uncertain original save cannot start a new copy that might duplicate an accepted request", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  await expect(editor.save("film", async () => { throw Error("Connection lost"); })).rejects.toThrow("Connection lost");
  let copies = 0;
  await expect(editor.save(null, async () => { copies++; return { project: { id: "copy" }, revision: "c1" }; })).rejects.toThrow("Connection lost");
  expect(copies).toBe(0);
});

test("an unknown recovery-copy ACK keeps the original blocked and cannot start another copy", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  await expect(editor.save("film", async () => { throw new ProjectSaveConflictError("Conflict"); })).rejects.toThrow("Conflict");
  const epoch = editor.contextEpoch;
  await expect(editor.save(null, async () => { throw Error("Copy ACK lost"); })).rejects.toThrow("Copy ACK lost");
  expect(editor.contextEpoch).toBe(epoch);
  let writes = 0;
  for (const id of ["film", null]) await expect(editor.save(id, async () => { writes++; return { project: { id: "wrong" }, revision: "wrong" }; })).rejects.toThrow("Copy ACK lost");
  expect(writes).toBe(0);
});

test("known rejected copies stay recoverable without advancing the original revision", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  await expect(editor.save("film", async () => { throw new ProjectSaveConflictError("Original conflict"); })).rejects.toThrow("Original conflict");
  const epoch = editor.contextEpoch;
  await expect(editor.save(null, async () => { throw new ProjectSaveConflictError("New ID already exists"); })).rejects.toThrow("New ID already exists");
  expect(editor.contextEpoch).toBe(epoch);
  let originalWrites = 0;
  await expect(editor.save("film", async () => { originalWrites++; return { project: { id: "film" }, revision: "wrong" }; })).rejects.toThrow("New ID already exists");
  expect(originalWrites).toBe(0);
  await editor.save(null, async base => { expect(base).toBe(undefined); return { project: { id: "other-copy" }, revision: "c1" }; });
});

test("a recovery copy with an original-project ACK cannot reopen writes to the original", async () => {
  const editor = new ProjectSaveSession(); editor.restore("film", "v1");
  await expect(editor.save("film", async () => { throw new ProjectSaveConflictError("Conflict"); })).rejects.toThrow("Conflict");
  await expect(editor.save(null, async () => ({ project: { id: "film" }, revision: "wrong" }))).rejects.toThrow("did not identify a new project");
  await expect(editor.save("film", async () => { throw Error("must not write"); })).rejects.toThrow("did not identify a new project");
});
