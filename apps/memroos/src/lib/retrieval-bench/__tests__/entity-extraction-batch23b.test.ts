// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch23b — classifyKind, collisions, limits", () => {
  it("rejects non-string extraction input", () => {
    const result = extractEntities(null as unknown as string, { nowIso: "2026-10-30T00:00:00.000Z" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("extraction_text_missing");
  });

  it("classifies ISO dates and REQ-style identifiers", () => {
    const iso = extractEntities("Ship before 2026-07-06T12:00:00Z.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(iso.entities.some((e) => e.kind === "date")).toBe(true);

    const id = extractEntities("Open ticket REQ-778899 for billing.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(id.entities.some((e) => e.kind === "identifier")).toBe(true);
  });

  it("records substring collisions between overlapping identifier spans", () => {
    const result = extractEntities("Compare REQ-778899 with REQ-7788 during audit.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.rejectedReasons.substringCollision).toBeGreaterThan(0);
  });

  it("classifies multi-word capitalized names as person", () => {
    const result = extractEntities("Escalate to Jane Doe immediately.", {
      nowIso: "2026-10-30T00:00:00.000Z",
    });
    expect(result.entities.some((e) => e.kind === "person")).toBe(true);
  });
});
