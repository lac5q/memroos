// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch29 — numeric date pattern", () => {
  it("classifies numeric slash dates (NUMERIC_DATE_PATTERN / date kind)", () => {
    const text = "The deadline was 03/01/2026 for the rollout.";
    const r = extractEntities(text);
    expect(r.ok).toBe(true);
    const dates = r.entities.filter((e) => e.kind === "date");
    expect(dates.some((e) => e.surface.includes("03/01/2026"))).toBe(true);
  });
});
