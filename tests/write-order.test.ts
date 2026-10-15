import type { PathLike } from "node:fs";
import { basename } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addNote, verifyLogbook } from "../src/store.js";
import { cleanup, copySample, freshLogbook } from "./helpers.js";

// Every call that puts bytes or a name on disk is noted here, in order, then made for real: the test
// reads the write order of SPEC §3 off the list. Nothing else changes.
const calls = vi.hoisted(() => ({ list: [] as string[], names: new Map<number, string>() }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const { basename } = await import("node:path");
  const name = (path: unknown): string => basename(String(path));
  return {
    ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>): number => {
      const fd = fs.openSync(...args);
      calls.names.set(fd, name(args[0]));
      return fd;
    },
    writeSync: (...args: Parameters<typeof fs.writeSync>): number => {
      calls.list.push(`write ${calls.names.get(args[0])}`);
      return (fs.writeSync as (...a: unknown[]) => number)(...args);
    },
    fsyncSync: (fd: number): void => {
      calls.list.push(`fsync ${calls.names.get(fd)}`);
      fs.fsyncSync(fd);
    },
    renameSync: (from: PathLike, to: PathLike): void => {
      calls.list.push(`rename ${name(from)} ${name(to)}`);
      fs.renameSync(from, to);
    },
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => {
      calls.list.push(`mkdir ${name(args[0])}`);
      return fs.mkdirSync(...args);
    },
  };
});

afterEach(cleanup);

/** The calls of one addNote that touch the record itself, not the lock in state/. */
function recordCalls(): string[] {
  return calls.list.filter((call) => !/writer\.lock|\bstate\b/.test(call));
}

describe("addNote writes in the order of SPEC §3", () => {
  it("the line written and fsynced to its month file, its folder fsynced; then logbook.json written to a temp file, fsynced, renamed into place, and the record folder fsynced", () => {
    const root = copySample();
    calls.list.length = 0;
    addNote(root, "in order", { now: new Date("2026-03-09T10:00:00Z") });
    const tmp = `.logbook.json.${process.pid}.tmp`;
    const syncs = recordCalls();
    // Folders are opened and fsynced on every platform Node runs on, Windows included.
    const folder = (name: string): string[] => [`fsync ${name}`];
    expect(syncs).toEqual([
      "mkdir 2026",
      "write 03.jsonl",
      "fsync 03.jsonl",
      ...folder("2026"),
      `write ${tmp}`,
      `fsync ${tmp}`,
      `rename ${tmp} logbook.json`,
      ...folder(basename(root)),
    ]);
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 33 });
  });

  it("a new year's folder and the logbook folder are fsynced in their parents before logbook.json names the line", () => {
    const root = freshLogbook();
    calls.list.length = 0;
    addNote(root, "the first line", { now: new Date("2027-01-01T00:00:00Z") });
    const syncs = recordCalls();
    const renamed = syncs.findIndex((call) => call.startsWith("rename "));
    const before = syncs.slice(0, renamed);
    expect(before.slice(0, 3)).toEqual(["mkdir 2027", "write 01.jsonl", "fsync 01.jsonl"]);
    // the month file's folder, the folder that gained 2027, and the record that gained logbook/
    expect(before).toEqual(
      expect.arrayContaining(["fsync 2027", "fsync logbook", `fsync ${basename(root)}`]),
    );
    expect(verifyLogbook(root)).toMatchObject({ valid: true, lines: 1 });
  });
});
