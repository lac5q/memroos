// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decideEntityMerge, extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch19", () => {
  it("classifies acronyms in mixed technical text", () => {
    const result = extractEntities("NASA launched Project Atlas at Acme Corporation.", {
      nowIso: "2026-07-10T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "acronym" && entity.surface === "NASA")).toBe(
      true,
    );
  });

  it("increments overEntityLimit when maxEntitiesPerTask is exceeded", () => {
    const text = Array.from({ length: 20 }, (_, index) => `REQ-${index}-TOKEN`).join(" ");
    const result = extractEntities(text, {
      nowIso: "2026-07-10T00:00:00.000Z",
      limits: { maxEntitiesPerTask: 3, maxExpansionPerEntity: 4, maxAliasChainLength: 4 },
    });
    expect(result.ok).toBe(true);
    expect(result.receipt.rejectedReasons.overEntityLimit).toBeGreaterThan(0);
  });

  it("decideEntityMerge rejects empty scope", () => {
    const result = extractEntities("Jane Doe", { nowIso: "2026-07-10T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    const merge = decideEntityMerge({
      scope: "",
      candidates: result.entities,
      nowIso: "2026-07-10T00:00:00.000Z",
    });
    expect(merge.ok).toBe(false);
    expect(merge.reason).toBe("scope_required");
    expect(merge.droppedEntities.length).toBe(result.entities.length);
  });
});
