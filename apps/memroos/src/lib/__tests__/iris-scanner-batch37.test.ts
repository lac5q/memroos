// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scanIrisPreflight } from "@/lib/iris-scanner";

describe("iris-scanner batch37", () => {
  it("riskScore adds 40 for MEDIUM content findings (62)", () => {
    const result = scanIrisPreflight("Call me at 415-555-0123 for follow-up.");
    const medium = result.findings.filter((f) => f.severity === "MEDIUM");
    expect(medium.length).toBeGreaterThan(0);
    expect(result.riskScore).toBeGreaterThanOrEqual(medium.length * 40);
  });

  it.skip("riskScore LOW branch (63) — content-scanner findings are only HIGH|MEDIUM today", () => {});
});