// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decideEntityMerge, extractEntities } from "../modules/entity-extraction";

describe("entity-extraction batch20b — date and newline surface guards", () => {
  it("classifies ISO and numeric dates as date entities", () => {
    const iso = extractEntities("Ship on 2026-07-10 before cutoff.", {
      nowIso: "2026-07-10T00:00:00.000Z",
    });
    expect(iso.ok).toBe(true);
    expect(iso.entities.some((entity) => entity.kind === "date" && entity.surface.includes("2026"))).toBe(
      true,
    );

    const numeric = extractEntities("Review by 07/10/2026 with ops.", {
      nowIso: "2026-07-10T00:00:00.000Z",
    });
    expect(numeric.ok).toBe(true);
    expect(numeric.entities.some((entity) => entity.kind === "date")).toBe(true);
  });

  it("classifies identifier-like tokens separately from acronyms", () => {
    const result = extractEntities("Track REQ-90210 in the ledger.", {
      nowIso: "2026-07-10T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    expect(result.entities.some((entity) => entity.kind === "identifier")).toBe(true);
  });

  it("decideEntityMerge rejects empty scopes after extraction", () => {
    const extracted = extractEntities("Jane Doe", { nowIso: "2026-07-10T00:00:00.000Z" });
    expect(extracted.ok).toBe(true);
    const merge = decideEntityMerge({
      scope: "",
      candidates: extracted.entities,
      nowIso: "2026-07-10T00:00:00.000Z",
    });
    expect(merge.ok).toBe(false);
    expect(merge.reason).toBe("scope_required");
  });
});
