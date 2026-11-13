// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractMemoryLabelSnapshot } from "@/lib/memory/policy-gate";

describe("policy-gate batch36 — readSpaceId null (99)", () => {
  it("extractMemoryLabelSnapshot preserves explicit null space_id", () => {
    const snapshot = extractMemoryLabelSnapshot({
      visibility: "internal",
      policy: "indexable",
      spaceId: null,
      space_id: null,
    });
    expect(snapshot?.spaceId).toBeNull();
  });
});
