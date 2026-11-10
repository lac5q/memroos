// @vitest-environment node
import path from "path";
import { describe, expect, it } from "vitest";

import { loadBeliefPromotionEvalCases } from "../belief-promotion-eval";

const CASES_PATH = path.resolve(process.cwd(), "../../evals/belief/cases.json");

describe("belief-promotion-eval batch13b — case catalog", () => {
  it("loads eval cases from evals/belief/cases.json", () => {
    const cases = loadBeliefPromotionEvalCases(CASES_PATH);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.every((c) => c.id && c.expectations)).toBe(true);
  });

  it("includes outbound policy expectations on gold cases", () => {
    const cases = loadBeliefPromotionEvalCases(CASES_PATH);
    expect(cases.some((c) => c.expectations.outboundReceiptAction !== undefined)).toBe(true);
  });

  it("returns unique case ids", () => {
    const cases = loadBeliefPromotionEvalCases(CASES_PATH);
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
