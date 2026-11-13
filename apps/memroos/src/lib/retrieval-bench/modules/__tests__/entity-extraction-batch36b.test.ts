// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch36b", () => {
  const nowIso = "2026-11-13T09:00:00.000Z";

  it("classifyKind ISO date surfaces date entities (271)", () => {
    const marker = randomUUID().slice(0, 8);
    const result = extractEntities(`Review on 2027-01-12 for batch36b ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "date")).toBe(true);
  });

  it("classifyKind unknown when surface lacks capitals (277)", () => {
    const result = extractEntities("only lowercase tokens here.", { nowIso });
    expect(result.entities.every((e) => e.kind !== "organization" || e.surface !== "only")).toBe(true);
  });
});
