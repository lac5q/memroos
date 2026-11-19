// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch21 — unknown kind and newline surface rejection", () => {
  it("classifies ISO-like proper-noun spans as date via classifyKind", () => {
    const result = extractEntities("Plan delivery for 2026-07-10 with ops.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "date" && entity.surface.includes("2026"))).toBe(
      true,
    );
  });

  it("rejects proper-noun captures whose surface contains a newline", () => {
    const withNewlineSurface = "Start\nBroken Entity name here.";
    const before = extractEntities(withNewlineSurface, { nowIso: "2026-10-28T00:00:00.000Z" });
    expect(before.ok).toBe(true);
    expect(before.entities.every((entity) => !/\n/.test(entity.surface))).toBe(true);

    const injected = withNewlineSurface.replace("Broken Entity", "Broken\nEntity");
    const after = extractEntities(injected, { nowIso: "2026-10-28T00:00:00.000Z" });
    expect(after.ok).toBe(true);
    expect(after.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });

  it("keeps identifier-like REQ tokens out of the unknown bucket", () => {
    const result = extractEntities("Track REQ-90210 in the ledger.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "identifier")).toBe(true);
  });
});
