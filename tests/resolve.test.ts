import { describe, expect, it } from "vitest";
import { buildResolver, type Ref } from "../src/resolve.js";
import type { Line } from "../src/types.js";

let seq = 0;
function line(kind: string, payload: Record<string, unknown>, id?: string): Line {
  seq += 1;
  return {
    id: id ?? `id-${seq}`,
    seq,
    at: "2026-03-15T09:00:00Z",
    end: null,
    tz: "Europe/Oslo",
    source: "test",
    kind,
    tier: 2,
    payload: { schema: `${kind}/v1`, ...payload } as Line["payload"],
    recorded_at: "2026-03-15T09:00:00Z",
    prev: "0".repeat(64),
    hash: "0".repeat(64),
  };
}
const person = { type: "person", id: "019c0000-0000-7000-8000-000000000001", registry: "logbook" };
const email: Ref = { kind: "email", value: "ines@example.org" };
const phone: Ref = { kind: "phone", value: "+4790000001" };
const handle: Ref = { kind: "handle", value: "236000000000001@lid" };
const entity = (ref: Ref, label: string, id?: string) =>
  line("resolution", { ref, entity: person, label }, id);
const alias = (ref: Ref, target: Ref, id?: string) =>
  line("resolution", { ref, alias_of: target, label: "alias label" }, id);
const retract = (id: string) => line("retraction", { supersedes: id, reason: "wrong" });

describe("buildResolver", () => {
  it("names a ref from its resolution line", () => {
    const r = buildResolver([entity(email, "Ines Holm")]);
    expect(r.name(email)).toBe("Ines Holm");
    expect(r.name(phone)).toBeUndefined();
  });

  it("lets the last line for a ref win, in chain order regardless of input order", () => {
    const first = entity(email, "Ines Holm");
    const second = entity(email, "Ines Holm-Berg");
    expect(buildResolver([second, first]).name(email)).toBe("Ines Holm-Berg");
  });

  it("hides a retracted resolution, and a retraction of the later line reveals the earlier", () => {
    const first = entity(email, "Ines Holm", "a");
    const second = entity(email, "Ines Holm-Berg", "b");
    expect(buildResolver([first, second, retract("b")]).name(email)).toBe("Ines Holm");
    expect(buildResolver([first, retract("a")]).name(email)).toBeUndefined();
  });

  it("skips a line that a later resolution supersedes", () => {
    const wrong = entity(email, "Wrong Person", "w");
    const fix = line("resolution", { ref: phone, entity: person, label: "Ola", supersedes: "w" });
    expect(buildResolver([wrong, fix]).name(email)).toBeUndefined();
    expect(buildResolver([wrong, fix]).name(phone)).toBe("Ola");
  });

  it("follows alias_of to the target's standing line, whichever was written first", () => {
    const lines = [alias(handle, phone), entity(phone, "Ola Nordmann")];
    expect(buildResolver(lines).name(handle)).toBe("Ola Nordmann");
    expect(buildResolver([...lines].reverse()).name(handle)).toBe("Ola Nordmann");
  });

  it("resolves nothing through a retracted alias or an alias to an unresolved ref", () => {
    const a = alias(handle, phone, "al");
    expect(buildResolver([a, entity(phone, "Ola"), retract("al")]).name(handle)).toBeUndefined();
    expect(buildResolver([a]).name(handle)).toBeUndefined();
  });

  it("follows at most 4 hops", () => {
    const refs = Array.from({ length: 6 }, (_, i): Ref => ({ kind: "handle", value: `h${i}` }));
    const chain = (n: number) => refs.slice(0, n).map((ref, i) => alias(ref, refs[i + 1] as Ref));
    const end = (n: number) => entity(refs[n] as Ref, "End");
    expect(buildResolver([...chain(4), end(4)]).name(refs[0] as Ref)).toBe("End");
    expect(buildResolver([...chain(5), end(5)]).name(refs[0] as Ref)).toBeUndefined();
  });

  it("stops on a cycle", () => {
    const a: Ref = { kind: "handle", value: "a" };
    const b: Ref = { kind: "handle", value: "b" };
    expect(buildResolver([alias(a, b), alias(b, a)]).name(a)).toBeUndefined();
    expect(buildResolver([alias(a, a)]).name(a)).toBeUndefined();
  });

  it("names nothing from an entity line without a label", () => {
    expect(
      buildResolver([line("resolution", { ref: email, entity: person })]).name(email),
    ).toBeUndefined();
  });

  it("ignores lines that are not resolution/v1 or retraction/v1, and malformed refs", () => {
    const r = buildResolver([
      line("note", { text: "x" }),
      line("resolution", { schema: "resolution/v2", ref: email, entity: person, label: "Future" }),
      line("resolution", { ref: "ines@example.org", entity: person, label: "Bad ref" }),
      line("resolution", { ref: { kind: "email" }, entity: person, label: "No value" }),
    ]);
    expect(r.name(email)).toBeUndefined();
  });

  it("reports which retraction hides a line, the highest seq winning", () => {
    const note = line("note", { text: "typo" }, "n");
    const r1 = retract("n");
    const r2 = retract("n");
    const r = buildResolver([note, r1, r2]);
    expect(r.retractedBy("n")).toBe(r2);
    expect(r.retractedBy("other")).toBeUndefined();
  });
});
