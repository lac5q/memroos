// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch30 — classifyKind and newline guards", () => {
  const nowIso = "2026-11-07T09:00:00.000Z";

  it("classifies ticket-shaped proper-noun spans via classifyKind identifier (272)", () => {
    const result = extractEntities(". REQ-88420 is open for batch30.", { nowIso });
    expect(result.entities.some((e) => e.kind === "identifier" && e.surface === "REQ-88420")).toBe(true);
  });

  it("rejects proper-noun captures whose surface contains a newline (362–363)", () => {
    const injected = "Start\nBroken\nEntity name here.";
    const after = extractEntities(injected, { nowIso });
    expect(after.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(after.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });

  it("still extracts numeric dates via the dedicated date scan (271–272 parity)", () => {
    const result = extractEntities("Freeze 11/07/2026 for batch30 rollout.", { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("11/07/2026"))).toBe(true);
  });
});
