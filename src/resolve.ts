import type { JsonValue, Line } from "./types.js";

/** A source-native identifier as raw lines carry it (RFC 0006): `{ kind, value }`. */
export interface Ref {
  kind: string;
  value: string;
}

const MAX_HOPS = 4;

/** What a resolution line standing says a ref is (RFC 0006): the entity, and the label it carried. */
export interface Resolved {
  type: string;
  id: string;
  registry: string;
  label: string | undefined;
}

export interface Resolver {
  /**
   * The name a ref resolves to through the record's own resolution lines, or undefined when no
   * line standing names an entity for it: last line wins, a retracted or superseded line does
   * not stand, `alias_of` is followed up to four hops and stops on a cycle (RFC 0006 rule 6).
   */
  name(ref: Ref): string | undefined;
  /** The entity the same walk reaches, with its label; undefined when it names nothing. */
  entity(ref: Ref): Resolved | undefined;
  /** The resolution line standing for this ref itself, before any `alias_of` is followed. */
  lineFor(ref: Ref): Line | undefined;
  /** The line the same walk ends on, the one that names the entity; undefined when it names nothing. */
  mintingLine(ref: Ref): Line | undefined;
  /** Every person the record's resolution lines standing mint: entity id to the last label given. */
  people(): Map<string, string>;
  /** The retraction that hides the line with this id, the highest `seq` winning (RFC 0003 rule 4). */
  retractedBy(id: string): Line | undefined;
  /**
   * Every ref whose walk reaches the entity, with the line standing for it, in `seq` order: the
   * lines that mint the entity and the alias lines that lead to it.
   */
  refsOf(id: string): Array<{ ref: Ref; line: Line }>;
}

/** Reads a ref object out of a payload field; undefined unless it has string `kind` and `value`. */
export function asRef(value: JsonValue | undefined): Ref | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const { kind, value: v } = value;
  if (typeof kind !== "string" || typeof v !== "string") return undefined;
  return { kind, value: v };
}

const key = (ref: Ref): string => `${ref.kind}\u0000${ref.value}`;

/**
 * Build the resolver from every line of the record, in any order. Only `resolution/v1` and
 * `retraction/v1` lines are kept, so the memory is the size of the record's judgements, not of
 * the record.
 */
export function buildResolver(lines: Iterable<Line>): Resolver {
  const resolutions: Line[] = [];
  const retractions = new Map<string, Line>();

  for (const line of lines) {
    const schema = line.payload?.schema;
    if (line.kind === "retraction" && schema === "retraction/v1") {
      const target = line.payload.supersedes;
      if (typeof target !== "string") continue;
      const standing = retractions.get(target);
      if (standing === undefined || standing.seq < line.seq) retractions.set(target, line);
    } else if (line.kind === "resolution" && schema === "resolution/v1") {
      resolutions.push(line);
    }
  }

  // A resolution is superseded while a resolution that is not retracted names it (the reference's
  // #321): a retracted one supersedes nothing, and one superseded in turn still supersedes.
  const superseded = new Set<string>();
  for (const line of resolutions) {
    if (retractions.has(line.id)) continue;
    if (typeof line.payload.supersedes === "string") superseded.add(line.payload.supersedes);
  }

  resolutions.sort((a, b) => a.seq - b.seq);
  const standing = new Map<string, Line>();
  for (const line of resolutions) {
    if (retractions.has(line.id) || superseded.has(line.id)) continue;
    const ref = asRef(line.payload.ref);
    if (ref === undefined) continue;
    standing.set(key(ref), line); // later seq overwrites: the last one wins
  }

  const entityOf = (line: Line): Resolved | undefined => {
    const entity = line.payload.entity;
    if (entity === null || typeof entity !== "object" || Array.isArray(entity)) return undefined;
    const { type, id, registry } = entity;
    if (typeof type !== "string" || typeof id !== "string") return undefined;
    const label = line.payload.label;
    return {
      type,
      id,
      registry: typeof registry === "string" ? registry : "",
      label: typeof label === "string" ? label : undefined,
    };
  };

  /** The line RFC 0006's walk ends on, the one that names the entity; undefined when it names nothing. */
  const minting = (ref: Ref): Line | undefined => {
    const visited = new Set<string>();
    let current = ref;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const k = key(current);
      if (visited.has(k)) return undefined; // a cycle
      visited.add(k);
      const line = standing.get(k);
      if (line === undefined) return undefined; // no line standing
      const alias = asRef(line.payload.alias_of);
      if (alias === undefined) return line;
      current = alias; // an alias line names nothing itself
    }
    return undefined; // more than MAX_HOPS aliases
  };
  const entity = (ref: Ref): Resolved | undefined => {
    const line = minting(ref);
    return line === undefined ? undefined : entityOf(line);
  };

  let known: Map<string, string> | undefined;
  let byEntity: Map<string, Array<{ ref: Ref; line: Line }>> | undefined;

  return {
    name(ref) {
      return entity(ref)?.label;
    },
    entity,
    lineFor(ref) {
      return standing.get(key(ref));
    },
    mintingLine: minting,
    people() {
      if (known === undefined) {
        known = new Map();
        for (const line of standing.values()) {
          const found = entityOf(line);
          if (found?.type === "person" && found.label !== undefined)
            known.set(found.id, found.label);
        }
      }
      return known;
    },
    retractedBy(id) {
      return retractions.get(id);
    },
    refsOf(id) {
      if (byEntity === undefined) {
        byEntity = new Map();
        const lines = [...standing.values()].sort((a, b) => a.seq - b.seq);
        for (const line of lines) {
          const ref = asRef(line.payload.ref);
          if (ref === undefined) continue;
          const found = entity(ref);
          if (found === undefined) continue;
          const list = byEntity.get(found.id) ?? [];
          list.push({ ref, line });
          byEntity.set(found.id, list);
        }
      }
      return byEntity.get(id) ?? [];
    },
  };
}

/**
 * A person's name as `people` gives it: the label of the first line standing, by `seq`, that names the
 * person by a ref of its own (not an `alias_of`); else the last label any line gave; undefined when
 * no line labels the person. The Day names a voice bound to the person by it too (RFC 0038 §3), as
 * the reference does at d053f78, whatever the binding line's own label.
 */
export function personName(resolver: Resolver, id: string): string | undefined {
  const minted = resolver
    .refsOf(id)
    .find(
      (r) =>
        asRef(r.line.payload.alias_of) === undefined && labelOf(r.line.payload.label) !== undefined,
    );
  return labelOf(minted?.line.payload.label) ?? resolver.people().get(id);
}

const labelOf = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
