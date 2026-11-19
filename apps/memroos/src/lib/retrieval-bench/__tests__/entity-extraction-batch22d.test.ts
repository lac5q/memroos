// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch22d — classifyKind and invalidSurface branches", () => {
  it("classifies slash numeric dates and REQ identifiers from proper-noun surfaces", () => {
    const slashDate = extractEntities("Deadline 07/10/2026 for rollout.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(slashDate.entities.some((entity) => entity.kind === "date")).toBe(true);

    const identifier = extractEntities("Track REQ-778899 before sign-off.", {
      nowIso: "2026-10-28T00:00:00.000Z",
    });
    expect(identifier.entities.some((entity) => entity.kind === "identifier")).toBe(true);
  });

  it("marks unknown-kind proper nouns and rejects newline-embedded surfaces", () => {
    const unknown = extractEntities("Contact Zq9 for access.", { nowIso: "2026-10-28T00:00:00.000Z" });
    expect(unknown.ok).toBe(true);
    expect(unknown.entities.some((entity) => entity.kind === "unknown" || entity.kind === "organization")).toBe(true);

    const injected = "Kickoff with Team\nLead on Monday.";
    const rejected = extractEntities(injected, { nowIso: "2026-10-28T00:00:00.000Z" });
    expect(rejected.receipt.rejectedReasons.invalidSurface).toBeGreaterThan(0);
  });
});
