// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scopeRecord } from "../msiq-adapter";

describe("msiq-adapter batch16b — scopeRecord", () => {
  it("scopeRecord serializes complete scope identity fields", () => {
    const record = scopeRecord({
      tenantId: "default-tenant",
      userId: "user-1",
      agentId: "agent-1",
      spaceId: "space-1",
      label: { visibility: "private", policy: "indexable", domain: "ops", sensitivity: "low" },
      purpose: "recall",
      beliefStage: "silver_candidate_claim",
    });
    expect(record).toMatchObject({
      tenantId: "default-tenant",
      userId: "user-1",
      agentId: "agent-1",
      spaceId: "space-1",
      purpose: "recall",
      beliefStage: "silver_candidate_claim",
    });
    expect(record.label).toMatchObject({ visibility: "private", policy: "indexable" });
  });
});
