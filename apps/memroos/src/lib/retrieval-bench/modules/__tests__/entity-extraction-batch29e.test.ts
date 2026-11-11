// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch29e — numeric date classification (271–272)", () => {
  it("classifies MM/DD/YYYY as date kind", () => {
    const out = extractEntities("Review memory policy on 03/15/2026 before enterprise rollout.");
    const dates = out.entities.filter((e) => e.kind === "date");
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.some((e) => e.surface.includes("03/15/2026") || e.canonical.includes("03/15/2026"))).toBe(true);
  });
});
