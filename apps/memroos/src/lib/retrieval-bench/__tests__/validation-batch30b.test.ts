// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { validateTask } from "../validation";

describe("retrieval-bench validation batch30b — candidate scope completeness", () => {
  it("validateTask flags incomplete corpus scope objects (lines 64–67)", () => {
    const base = {
      id: `task-b30b-${randomUUID().slice(0, 8)}`,
      dataset: "memroos_public_synthetic",
      task_type: "single_hop",
      corpus: [
        {
          id: "c1",
          text: "corpus",
          scope: { tenantId: "t", userId: "u", agentId: "a", spaceId: "s" },
        },
      ],
      question: "q?",
      expected_answer: "corpus",
      evidence_spans: ["c1"],
      citation: "batch30b",
      provenance: {
        dataset_version: "1",
        license: "internal",
        sourceCitation: "batch30b",
      },
    };

    const missingLabel = validateTask(base, { seenIds: new Set() });
    expect(missingLabel.ok).toBe(false);
    expect(missingLabel.issues.some((i) => i.reason === "candidate_scope_invalid")).toBe(true);

    const notObject = validateTask(
      {
        ...base,
        corpus: [{ id: "c2", text: "x", scope: "not-an-object" }],
      },
      { seenIds: new Set() },
    );
    expect(notObject.ok).toBe(false);
  });
});
