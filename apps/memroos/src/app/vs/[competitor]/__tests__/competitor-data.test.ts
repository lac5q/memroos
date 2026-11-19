import { describe, expect, it } from "vitest";

import {
  COMPETITOR_SLUGS,
  CRITERIA_LABELS,
  MEMROOS_TOTAL_SCORE,
  getCompetitorData,
} from "../competitor-data";

describe("competitor-data", () => {
  it("lists known competitor slugs", () => {
    expect(COMPETITOR_SLUGS).toContain("letta");
    expect(COMPETITOR_SLUGS.length).toBeGreaterThan(3);
  });

  it("returns competitor data for valid slug", () => {
    const letta = getCompetitorData("letta");
    expect(letta).not.toBeNull();
    expect(letta?.name).toBe("Letta");
    expect(letta?.totalScore).toBeGreaterThan(0);
  });

  it("returns null for unknown slug", () => {
    expect(getCompetitorData("not-a-real-competitor.test")).toBeNull();
  });

  it("defines benchmark criteria labels and MemroOS total", () => {
    expect(Object.keys(CRITERIA_LABELS).length).toBeGreaterThan(5);
    expect(MEMROOS_TOTAL_SCORE).toBeGreaterThan(50);
  });
});
