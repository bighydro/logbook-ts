import { afterEach, describe, expect, it } from "vitest";
import { readDay } from "../src/day.js";
import { readDayRows } from "../src/days.js";
import { renderDay } from "../src/dayText.js";
import { isMachineLine, isMachineParticipant } from "../src/machine.js";
import { readPeople, renderPeople } from "../src/people.js";
import { cleanup, writeRecord } from "./helpers.js";
import { DAY, EXPECTED_PEOPLE, EXPECTED_WITH, machineRecord } from "./machine-cases.js";

afterEach(cleanup);

describe("the machine mark (the reference's docs/adapters/agents.md): only the literal true marks anything", () => {
  it("a message the agent wrote, and every line of a conversation with an agent", () => {
    expect(isMachineLine({ schema: "message/v1", extra: { machine: true } })).toBe(true);
    expect(
      isMachineLine({ schema: "message/v1", extra: { counterpart: { kind: "agent", ref: {} } } }),
    ).toBe(true);
    for (const extra of [
      { machine: "true" },
      { machine: 1 },
      { machine: false },
      { counterpart: { kind: "person" } },
      { counterpart: { kind: "Agent" } },
      { counterpart: "agent" },
      {},
    ]) {
      expect({ extra, marked: isMachineLine({ schema: "message/v1", extra }) }).toEqual({
        extra,
        marked: false,
      });
    }
    expect(isMachineLine({ schema: "message/v1", extra: "machine" })).toBe(false);
    expect(isMachineLine({ schema: "message/v1" })).toBe(false);
  });

  it("a participant of a transcript that is an agent", () => {
    expect(isMachineParticipant({ name: "assistant", machine: true })).toBe(true);
    for (const machine of ["yes", 1, false, null]) {
      expect(isMachineParticipant({ name: "assistant", machine })).toBe(false);
    }
    expect(isMachineParticipant({ name: "Ola" })).toBe(false);
  });
});

describe("no reader takes an agent for a person, as the reference reads the mark at d053f78 (run)", () => {
  it("people: the bots and the assistant are no one; the people beside them are counted as before", () => {
    const root = writeRecord(machineRecord());
    expect(renderPeople(readPeople(root, {}), {})).toBe(EXPECTED_PEOPLE);
  });

  it("the Day: an assistant among a call's participants is never company", () => {
    const root = writeRecord(machineRecord());
    const text = renderDay(readDay(root, { day: DAY }));
    expect(text.split("\n").filter((row) => row.startsWith("      with "))).toEqual([
      EXPECTED_WITH,
    ]);
    expect(readDayRows(root, { from: DAY, to: DAY }).rows[0]?.people).toEqual({
      confirmed: 2,
      names: ["Ola Nordmann", "Kari Moe"],
    });
  });
});
