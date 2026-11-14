// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { extractEntities } from "../entity-extraction";

describe("entity-extraction batch32 — classifyKind date/unknown and newline guard", () => {
  const marker = randomUUID().slice(0, 8);
  const nowIso = "2026-11-09T09:00:00.000Z";

  it("classifyKind date branch via ISO-shaped proper-noun capture (271)", () => {
    const result = extractEntities(`Anchor 2026-11-09T12:00:00Z milestone ${marker}.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "date" && e.surface.includes("2026-11-09"))).toBe(true);
  });

  it("classifyKind unknown for digit-heavy proper-noun token (277)", () => {
    const result = extractEntities(`Escalate Zq9-${marker} before cutover.`, { nowIso });
    expect(result.entities.some((e) => e.kind === "unknown" || e.kind === "organization")).toBe(true);
  });

  it("rejects proper-noun surfaces that embed a newline (362–363)", () => {
    const injected = `Start\nBroken\nEntity ${marker} here.`.replace("Broken\nEntity", "Broken\nEntity");
    const after = extractEntities(injected, { nowIso });
    expect(after.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(after.entities.every((e) => !/\n/.test(e.surface))).toBe(true);
  });
});
