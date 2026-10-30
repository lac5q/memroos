// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch23 — classifyKind organization and newline surfaces", () => {
  it("classifies single capitalized tokens as organization", () => {
    const result = extractEntities("Acme shipped the release.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(result.entities.some((entity) => entity.kind === "organization" && entity.surface === "Acme")).toBe(true);
  });

  it("rejects proper-noun surfaces that embed newlines", () => {
    const text = "Kickoff with Team\nLead on Monday.";
    const result = extractEntities(text, { nowIso: "2026-10-28T00:00:00.000Z" });
    expect(result.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
    expect(result.entities.some((entity) => entity.surface.includes("\n"))).toBe(false);
  });

  it("classifies multi-word capitalized names as person", () => {
    const result = extractEntities("Escalate to Jane Doe immediately.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(result.entities.some((entity) => entity.kind === "person")).toBe(true);
  });
});
